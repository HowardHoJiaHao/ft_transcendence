package importcsv

import (
	"database/sql"
	"errors"
	"log"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/modules/geo"
	"transcendence/modules/listing"
	"transcendence/myMiddleware"
)

type Handler struct {
	gormDB *gorm.DB
	rawDB  *sql.DB
}

func NewHandler(gormDB *gorm.DB, rawDB *sql.DB) *Handler {
	return &Handler{gormDB: gormDB, rawDB: rawDB}
}

func (h *Handler) RegisterRoutes(v1 *echo.Group) {
	protected := v1.Group("")
	protected.Use(myMiddleware.JWTAuth(h.rawDB))
	protected.POST("/products/import", h.importProducts)
}

const maxImportRows = 500

// Request body shape. Items reuses CreateProductRequest so a bulk-imported
// listing and a singly-created one accept exactly the same fields.
type ImportProductsRequest struct {
	Items []listing.CreateProductRequest `json:"items"`
}

// One validation failure, addressed to a row of the uploaded file.
//
// Row is 1-based over the items array, which matches the line numbers the
// import preview shows the user, so a server-side rejection points at the same
// row they already saw on screen. Field names the offending column so the UI
// can say precisely what to fix.
type ImportRowError struct {
	Row     int    `json:"row"` // 1-based position inside items
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Response body for both outcomes.
//
// Success: Imported holds the count and IDs the new listing IDs.
// Failure:  Errors holds every row-level problem found, and Imported is 0.
// The omitempty tags keep whichever half is irrelevant out of the JSON.
type ImportProductsResponse struct {
	Imported int              `json:"imported"`
	IDs      []int            `json:"ids,omitempty"`
	Errors   []ImportRowError `json:"errors,omitempty"`
}

// validateImportRow checks a single row against the same rules createProduct
// enforces for a one-off listing, so importing 100 products cannot slip past
// constraints that creating them individually would have caught.
func validateImportRow(row int, item listing.CreateProductRequest) []ImportRowError {
	var errs []ImportRowError

	// title: required. TrimSpace so a cell of only spaces counts as empty.
	if strings.TrimSpace(item.Title) == "" {
		errs = append(errs, ImportRowError{Row: row, Field: "title", Message: "title is required"})
	}

	// price: required and strictly positive. A missing JSON field decodes to
	// 0, so this single check catches both "absent" and "zero or negative".
	if item.Price <= 0 {
		errs = append(errs, ImportRowError{Row: row, Field: "price", Message: "price must be greater than 0"})
	}

	// originalPrice: optional (hence *float64), but meaningless at <= 0 since
	// it renders as a struck-through "was" price above the real one.
	if item.OriginalPrice != nil && *item.OriginalPrice <= 0 {
		errs = append(errs, ImportRowError{Row: row, Field: "originalPrice", Message: "originalPrice must be greater than 0 when set"})
	}

	// stockQuantity: optional, defaults to 1 below. A listing with 0 stock
	// would be immediately unbuyable, so reject it rather than import it.
	if item.StockQuantity != nil && *item.StockQuantity < 1 {
		errs = append(errs, ImportRowError{Row: row, Field: "stockQuantity", Message: "stockQuantity must be at least 1"})
	}

	// The same ceilings a single-listing POST is held to, so a CSV row cannot
	// land a listing the sell form would have rejected.
	for _, problem := range listing.OutOfRangeListingFields(item) {
		errs = append(errs, ImportRowError{Row: row, Field: problem.Field, Message: problem.Message})
	}

	// Fill the dropdown attributes Post an Ad pre-selects, exactly as
	// createProduct does, so an empty cell is acceptable and falls back to the
	// same default a seller clicking straight through the form would get.
	// `item` is a value parameter, so this mutates only this copy — the insert
	// loop applies the identical defaults through applyImportDefaults.
	//
	// Running BEFORE the check below is what leaves only location and
	// dealingMethod able to fail: the two the form itself refuses to invent.
	listing.ApplyListingDefaults(&item)

	// The caller-owned listing attributes, shared with createProduct so a CSV
	// row cannot land a listing the sell form would have rejected. Reported
	// individually so the import preview can highlight each offending column.
	for _, missing := range listing.MissingListingFields(item) {
		errs = append(errs, ImportRowError{Row: row, Field: missing.Field, Message: missing.Message})
	}

	return errs
}

// applyImportDefaults stamps the authenticated caller onto a row.
//
// Takes a pointer and mutates in place; the caller passes a copy of the item
// so the original request slice stays untouched.
//
// SellerID and SellerName are overwritten unconditionally — never merely
// defaulted. That is the security-relevant line in this file: whatever the
// request body claimed about ownership is discarded and replaced with the
// authenticated caller's identity.
func applyImportDefaults(item *listing.CreateProductRequest, sellerID int, sellerName string) {
	item.SellerID = sellerID
	item.SellerName = sellerName
	// Discarded for the same reason createProduct discards it: an image becomes
	// a listing's cover only by passing through the upload endpoint's ownership,
	// size and content-type checks, and this column is rendered as an <img src>.
	// The CSV has no image column, so this only ever strips a value a direct API
	// caller supplied by hand.
	item.Image = ""
	// The same dropdown defaults createProduct applies, so a blank optional
	// cell imports identically to a blank field on a single-listing POST.
	// validateImportRow already ran this over its own copy, so the row is known
	// to survive missingListingFields once these are filled in.
	listing.ApplyListingDefaults(item)
}

// importProducts handles a bulk import request end to end.
//
// The order of operations matters and is deliberate:
//
//  1. authenticate      — establish who owns the resulting listings
//  2. decode + bounds   — cheap rejections before any per-row work
//  3. look up seller    — one query, reused for every row
//  4. validate ALL rows — no database writes yet
//  5. insert ALL rows   — one transaction, commit only if every row lands
func (h *Handler) importProducts(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// STEP 1 — Authenticate.
	sellerID, ok := c.Get("userId").(int)
	if !ok || sellerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	// STEP 2 — Decode and bounds-check.
	var req ImportProductsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request body"})
	}
	if len(req.Items) == 0 {
		return c.JSON(400, map[string]string{"error": "items cannot be empty"})
	}
	// Caps the work a single request can demand.
	if len(req.Items) > maxImportRows {
		return c.JSON(400, map[string]string{"error": "too many items in one import (max 500)"})
	}

	// STEP 3 — Get the seller's account. Imported listings inherit their
	// location from it, exactly as a single-listing POST does.
	seller, err := listing.LookupSellerProfile(h.gormDB, sellerID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("Error looking up seller for import: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to validate seller"})
	}
	sellerName := seller.Username
	if sellerName == "" {
		sellerName = "Unknown Seller"
	}
	if seller.Incomplete() {
		return c.JSON(400, map[string]string{"error": listing.IncompleteProfileError})
	}
	canonicalState, canonicalDistrict, ok := geo.Resolve(seller.State, seller.District)
	if !ok {
		return c.JSON(400, map[string]string{"error": listing.IncompleteProfileError})
	}

	// STEP 4 — Validate every row before touching the database.
	var rowErrors []ImportRowError
	for i, item := range req.Items {
		rowErrors = append(rowErrors, validateImportRow(i+1, item)...)
	}
	if len(rowErrors) > 0 {
		// Imported: 0 is explicit — nothing was written, and no transaction
		// was even opened.
		return c.JSON(400, ImportProductsResponse{Imported: 0, Errors: rowErrors})
	}

	// STEP 5 — Insert everything inside one transaction.
	//
	// Every row is already known to be valid, so the transaction exists to
	// guard against database-level failures (constraint violations, lost
	// connections) mid-way through a long batch.
	tx, err := sqlDB.Begin()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to start import"})
	}
	// Rollback on every path that is not a successful Commit. Once Commit has
	// succeeded this is a no-op, so the deferred call is safe to register
	// unconditionally and guarantees no transaction is ever left dangling.
	defer tx.Rollback()

	insertQuery := `INSERT INTO listings (
		seller_id, title, description, weight_category, flexibility_category, balance_category,
		price, original_price, location, state, image, seller_name, is_new, is_featured, status,
		category, condition, dealing_method, stock_quantity
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$16,$17,$18)
	RETURNING id`

	// Pre-sized: the exact final length is known, so this allocates once.
	ids := make([]int, 0, len(req.Items))

	for i := range req.Items {
		// Copy before mutating. applyImportDefaults writes through its pointer,
		// and this keeps those writes off the caller's request slice.
		item := req.Items[i]
		applyImportDefaults(&item, sellerID, sellerName)

		// stockQuantity is *int in the request so "absent" is distinguishable
		// from an explicit 0; unwrap it to a plain int, defaulting to 1.
		// Validation above already rejected any explicit value below 1.
		stockQuantity := 1
		if item.StockQuantity != nil {
			stockQuantity = *item.StockQuantity
		}

		var productID int
		if err := tx.QueryRow(insertQuery,
			item.SellerID, item.Title, item.Description, item.WeightCategory, item.FlexibilityCategory,
			item.BalanceCategory, item.Price, item.OriginalPrice, canonicalDistrict, canonicalState, item.Image, sellerName,
			item.IsNew, item.IsFeatured, item.Category, item.Condition, item.DealingMethod,
			stockQuantity,
		).Scan(&productID); err != nil {
			// Returning here triggers the deferred Rollback, discarding every row inserted so far.
			log.Printf("Error importing product (row %d): %v", i+1, err)
			return c.JSON(500, map[string]string{"error": "Failed to import products"})
		}
		ids = append(ids, productID)
	}

	// The commit is the moment the import becomes real. Until this succeeds,
	// none of the rows above are visible to any other connection.
	if err := tx.Commit(); err != nil {
		log.Printf("Error committing product import: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete import"})
	}

	// 201 Created with the count the UI reports
	return c.JSON(201, ImportProductsResponse{Imported: len(ids), IDs: ids})
}
