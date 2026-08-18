package listing

import (
	"database/sql"
	"log"
	"sort"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

func (h *Handler) RegisterPublicAPI(public *echo.Group) {
	public.GET("/products", h.getProductsForAPIKey)
	public.GET("/products/:id", h.getProductByIDForAPIKey)
	public.POST("/products", h.createProduct)
	// Its own handler, not the JWT route's: the web edit form replaces a whole
	// listing, while this surface stays a narrow six-field patch.
	public.PUT("/products/:id", h.updateProductForAPIKey)
	public.DELETE("/products/:id", h.deleteProduct)
}

// ─── DEVELOPER API READ GUARDS ───────────────────────────────────────────────
//
// The public surface serves one account: the key's. Writes enforce that already
// (seller comes from c.Get("userId"); update/delete refuse listings they do not
// own), but the reads cannot — on /api/v1 they are deliberately open, since the
// home page and search read everyone's listings without a login. So the
// restriction lives in these two wrappers, registered only on the public group.

// The only query parameters the developer API accepts. getProducts understands
// eight more, which still serve /api/v1; anything outside this set is refused
// rather than quietly honoured. sellerId is absent on purpose — scoping is not
// the caller's to request, and the handler forces it from the key below.
var publicProductQueryParams = map[string]bool{
	"limit":  true,
	"sort":   true,
	"status": true,
}

func rejectUnsupportedQueryParams(c echo.Context, allowed map[string]bool) error {
	var unsupported []string
	for name := range c.QueryParams() {
		if !allowed[name] {
			unsupported = append(unsupported, name)
		}
	}
	if len(unsupported) == 0 {
		return nil
	}
	sort.Strings(unsupported)
	return c.JSON(400, map[string]string{
		"error": "unsupported query parameter(s): " + strings.Join(unsupported, ", ") +
			"; this API accepts only supported parameters",
	})
}

// getProductsForAPIKey serves GET /api/public/v1/products, always scoped to the
// key's own account, and accepting only the filters in
// publicProductQueryParams. Anything else is refused rather than silently
// dropped, so a developer sees why their filter did not do what they expected.
func (h *Handler) getProductsForAPIKey(c echo.Context) error {
	// Set by APIKeyAuth. Absent means the route lost its middleware — refuse
	// rather than fall through to an unscoped listing.
	callerID, ok := c.Get("userId").(int) // who you are
	if !ok || callerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	// Collected and sorted rather than failing on the first hit, so the message
	// is deterministic despite Go's random map iteration and names everything to
	// fix at once. Runs BEFORE the forced sellerId, which would otherwise trip
	// this very check.
	if err := rejectUnsupportedQueryParams(c, publicProductQueryParams); err != nil {
		return err
	}

	// Forced on every request, including ones that sent no sellerId — without
	// this the endpoint returns the whole marketplace. Echo caches the parsed
	// query on the context, so mutating that map is what getProducts reads.
	// TestGetProductsForAPIKeyAlwaysFiltersToCaller asserts the id reaches the
	// SQL, so a change in that caching fails a test rather than leaking.
	c.QueryParams().Set("sellerId", strconv.Itoa(callerID))

	return h.getProducts(c)
}

// getProductByIDForAPIKey serves GET /api/public/v1/products/:id for listings
// the key's account owns, and 404s everything else.
//
// 404 rather than 403 for someone else's listing: answering both identically
// stops the endpoint being walked to discover which ids exist.
func (h *Handler) getProductByIDForAPIKey(c echo.Context) error {
	if err := rejectUnsupportedQueryParams(c, map[string]bool{}); err != nil {
		return err
	}
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	callerID, ok := c.Get("userId").(int)
	if !ok || callerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "invalid product id"})
	}

	// Ownership is checked with its own narrow query before the full row is
	// fetched, the same shape updateProduct and deleteProduct use.
	var sellerID int
	err = sqlDB.QueryRow("SELECT seller_id FROM listings WHERE id = $1", id).Scan(&sellerID)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("Error checking listing ownership for API key request: %v", err)
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if err == sql.ErrNoRows || sellerID != callerID {
		return c.JSON(404, map[string]string{"error": "Listing not found in this account"})
	}

	return h.getProductByID(c)
}

// updateProductForAPIKey backs PUT /api/public/v1/products/:id: a narrow
// partial patch of six fields, status not settable, omitted fields unchanged.
//
// Separate from the web form's handler on purpose — a key holder should not be
// able to rewrite the phone number buyers use to reach the seller.
func (h *Handler) updateProductForAPIKey(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	id, userID, err := updateTarget(c)
	if err != nil {
		return err
	}
	current, err := loadListingForUpdate(c, sqlDB, id, userID)
	if err != nil {
		return err
	}

	var req UpdateProductRequest
	if err := bindStrictJSON(c, &req); err != nil {
		return err
	}
	if req.Title == nil && req.Description == nil && req.Price == nil &&
		req.Location == nil && req.Category == nil && req.StockQuantity == nil {
		return c.JSON(400, map[string]string{"error": "At least one field must be provided to update"})
	}

	title := current.Title
	if req.Title != nil {
		title = *req.Title
	}
	if title == "" {
		return c.JSON(400, map[string]string{"error": "title is required"})
	}

	price := current.Price
	if req.Price != nil {
		price = *req.Price
	}
	if price <= 0 {
		return c.JSON(400, map[string]string{"error": "price must be greater than 0"})
	}

	description := current.Description
	if req.Description != nil {
		description = *req.Description
	}

	category := current.Category
	if req.Category != nil {
		category = *req.Category
	}

	location := current.Location
	if req.Location != nil {
		location = *req.Location
	}

	stockQuantity := current.StockQuantity
	if req.StockQuantity != nil {
		stockQuantity = *req.StockQuantity
	}
	if stockQuantity < 0 {
		return c.JSON(400, map[string]string{"error": "stockQuantity cannot be negative"})
	}

	// Merged values, so a patch is held to the same ceilings as a create even
	// when it only sends one of the four.
	if problems := OutOfRangeListingFields(CreateProductRequest{
		Title:         title,
		Description:   description,
		Price:         price,
		StockQuantity: &stockQuantity,
	}); len(problems) > 0 {
		return c.JSON(400, map[string]string{"error": problems[0].Message})
	}

	// The racket specs are not patchable here; they only ever follow the
	// category, so moving a listing out of Rackets clears them.
	weightCategory := current.WeightCategory
	flexibilityCategory := current.FlexibilityCategory
	balanceCategory := current.BalanceCategory
	clearNonRacketSpecFields(category, &weightCategory, &flexibilityCategory, &balanceCategory)

	_, err = sqlDB.Exec(`UPDATE listings SET
		title=$1, description=$2, price=$3, location=$4,
		category=$5, weight_category=$6, flexibility_category=$7, balance_category=$8,
		status=$9, stock_quantity=$10, updated_at=CURRENT_TIMESTAMP WHERE id=$11`,
		title, description, price, location, category,
		weightCategory, flexibilityCategory, balanceCategory, current.Status, stockQuantity, id)
	if err != nil {
		log.Printf("Error updating listing %d via API key: %v", id, err)
		return c.JSON(500, map[string]string{"error": "Failed to update product"})
	}

	product, err := fetchProductByID(sqlDB, id)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to fetch updated product"})
	}
	return c.JSON(200, product)
}
