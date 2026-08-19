package listing

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/modules/geo"
	"transcendence/modules/listing/files"
	"transcendence/myMiddleware"
)

type Handler struct {
	gormDB *gorm.DB
	rawDB  *sql.DB
}

func NewHandler(gormDB *gorm.DB, rawDB *sql.DB) *Handler {
	return &Handler{gormDB: gormDB, rawDB: rawDB}
}

// protected means this route is logged-in only
// this is to create new products, will be concatenate with the /api/v1/ as suffix
// when a post request to /api/v1/products reach echo
// then it will call this createProduct handler
func (h *Handler) RegisterRoutes(v1 *echo.Group) {
	v1.GET("/products", h.getProducts)
	v1.GET("/products/:id", h.getProductByID)

	protected := v1.Group("")
	protected.Use(myMiddleware.JWTAuth(h.rawDB))

	protected.POST("/products", h.createProduct)
	protected.PUT("/products/:id", h.updateProduct)
	protected.DELETE("/products/:id", h.deleteProduct)
}

// list all products with filters
func (h *Handler) getProducts(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	category := c.QueryParams()["category"]
	weightCategory := c.QueryParams()["weightCategory"]
	flexibilityCategory := c.QueryParams()["flexibilityCategory"]
	balanceCategory := c.QueryParams()["balanceCategory"]
	location := c.QueryParams()["location"]
	state := c.QueryParams()["state"]
	search := c.QueryParam("search")
	sortBy := c.QueryParam("sort")
	limit := c.QueryParam("limit")
	offset := c.QueryParam("offset")
	sellerId := c.QueryParam("sellerId")
	status := c.QueryParam("status")
	minPrice := c.QueryParam("minPrice")
	maxPrice := c.QueryParam("maxPrice")

	if limit == "" {
		limit = "20"
	}
	if offset == "" {
		offset = "0"
	}

	limitInt, err := strconv.Atoi(limit)
	if err != nil || limitInt <= 0 {
		limitInt = 20
	}
	if limitInt > 100 {
		limitInt = 100
	}
	offsetInt, err := strconv.Atoi(offset)
	if err != nil || offsetInt < 0 {
		offsetInt = 0
	}

	query := "SELECT " + listingSelectCols + listingFromClause
	whereClause := " WHERE 1=1"
	var args []interface{}

	if len(category) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range category {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos+i)
			args = append(args, category[i])
		}
		whereClause += " AND l.category IN (" + placeholders + ")"
	}
	if len(weightCategory) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range weightCategory {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos+i)
			args = append(args, weightCategory[i])
		}
		whereClause += " AND l.weight_category IN (" + placeholders + ")"
	}
	if len(flexibilityCategory) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range flexibilityCategory {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos+i)
			args = append(args, flexibilityCategory[i])
		}
		whereClause += " AND l.flexibility_category IN (" + placeholders + ")"
	}
	if len(balanceCategory) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range balanceCategory {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos+i)
			args = append(args, balanceCategory[i])
		}
		whereClause += " AND l.balance_category IN (" + placeholders + ")"
	}
	if len(location) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range location {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos+i)
			args = append(args, location[i])
		}
		whereClause += " AND l.location IN (" + placeholders + ")"
	}
	if len(state) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range state {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos+i)
			args = append(args, state[i])
		}
		whereClause += " AND l.state IN (" + placeholders + ")"
	}
	if search != "" {
		whereClause += fmt.Sprintf(" AND l.title ILIKE $%d", len(args)+1)
		args = append(args, "%"+search+"%")
	}
	if minPrice != "" {
		minPriceFloat, err := strconv.ParseFloat(minPrice, 64)
		if err == nil && minPriceFloat >= 0 {
			whereClause += fmt.Sprintf(" AND l.price >= $%d", len(args)+1)
			args = append(args, minPriceFloat)
		}
	}
	if maxPrice != "" {
		maxPriceFloat, err := strconv.ParseFloat(maxPrice, 64)
		if err == nil && maxPriceFloat >= 0 {
			whereClause += fmt.Sprintf(" AND l.price <= $%d", len(args)+1)
			args = append(args, maxPriceFloat)
		}
	}
	if sellerId != "" {
		sellerIdInt, err := strconv.Atoi(sellerId)
		if err == nil {
			whereClause += fmt.Sprintf(" AND l.seller_id = $%d", len(args)+1)
			args = append(args, sellerIdInt)
		}
	}
	// Public browse keeps sold-out listings visible as marketplace history, but
	// never surfaces an in-stock pending reservation. The client renders these
	// zero-stock cards as Sold and disables purchase actions. Callers that manage
	// their own listings (My Shop, the seller dashboard) pass an explicit status.
	if status == "" {
		whereClause += " AND (l.status = 'active' OR (l.status IN ('pending', 'sold') AND COALESCE(l.stock_quantity, 0) = 0))"
	} else {
		whereClause += fmt.Sprintf(" AND l.status = $%d", len(args)+1)
		args = append(args, status)
	}

	countQuery := "SELECT COUNT(*)" + listingFromClause + whereClause
	var totalCount int
	err = sqlDB.QueryRow(countQuery, args...).Scan(&totalCount)
	if err != nil {
		log.Printf("Error querying products count: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch products count"})
	}

	query += whereClause
	// No "rating" or "most sold" option here. A listing is bought as one whole
	// lot, so it carries at most one review and has no units-sold total --
	// either sort would have ordered the catalogue by a number that cannot
	// meaningfully vary between listings.
	if sortBy == "price-low" {
		query += " ORDER BY l.price ASC"
	} else if sortBy == "price-high" {
		query += " ORDER BY l.price DESC"
	} else if sortBy == "newest" {
		// Keep the live marketplace fresh: sold-out cards remain visible, but
		// they always follow listings that buyers can still purchase.
		query += " ORDER BY CASE WHEN l.status <> 'active' OR COALESCE(l.stock_quantity, 0) = 0 THEN 1 ELSE 0 END ASC, l.id DESC"
	} else {
		query += " ORDER BY l.is_featured DESC, l.id DESC"
	}

	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limitInt, offsetInt)

	rows, err := sqlDB.Query(query, args...) // get from the database
	if err != nil {
		log.Printf("Error querying products: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch products"})
	}
	defer rows.Close()

	products, err := scanProducts(rows)
	if err != nil {
		log.Printf("Error scanning products: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to scan products"})
	}

	// Seller phone numbers are contact PII. The list endpoint is public and
	// bulk-paginated, so it must never expose them — otherwise a single
	// unauthenticated scrape harvests every seller's phone number. Phone
	// numbers are revealed only on the detail endpoint, and only to
	// authenticated users.
	for i := range products {
		products[i].PhoneNumber = ""
	}

	return c.JSON(200, map[string]interface{}{
		"products": products,
		"total":    totalCount,
	})
}

func (h *Handler) getProductByID(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "invalid product id"})
	}
	product, err := fetchProductByID(sqlDB, id)
	if err == sql.ErrNoRows {
		return c.JSON(404, map[string]string{"error": "Product not found"})
	}
	if err != nil {
		log.Printf("Error querying product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch product"})
	}

	// The seller's phone number is contact PII. Reveal it only to authenticated
	// users so anonymous visitors cannot read (or scrape) seller contact
	// details. The JWT must still belong to an active database user.
	if uid, _, authErr := myMiddleware.OptionalJWTAuth(c, sqlDB); authErr != nil || uid <= 0 {
		product.PhoneNumber = ""
	}

	recordListingView(sqlDB, product.ID, product.SellerId, c)

	return c.JSON(200, product)
}

// createProduct: parse JSON → seller from JWT → validate → insert → return the listing
func (h *Handler) createProduct(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// error handling, if json malformed
	var req CreateProductRequest
	if err := bindStrictJSON(c, &req); err != nil {
		return err
	}
	// seller identity from the JWT
	sellerID, ok := c.Get("userId").(int)
	if !ok || sellerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}
	// create must not accept an image URL in JSON; photos go through the file upload path
	req.Image = ""

	// field validation
	if req.Title == "" {
		return c.JSON(400, map[string]string{"error": "title is required"})
	}
	if req.Price <= 0 {
		return c.JSON(400, map[string]string{"error": "price must be greater than 0"})
	}
	if problems := OutOfRangeListingFields(req); len(problems) > 0 {
		return c.JSON(400, map[string]string{"error": problems[0].Message})
	}
	// error handling
	stockQuantity := 1
	if req.StockQuantity != nil {
		stockQuantity = *req.StockQuantity
	}
	if stockQuantity < 1 {
		return c.JSON(400, map[string]string{"error": "stockQuantity must be at least 1"})
	}

	// looks up the seller username
	// Shared with listing/importcsv so a single-listing POST and a bulk import
	// resolve the seller's name the same way.
	seller, err := LookupSellerProfile(h.gormDB, sellerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(404, map[string]string{"error": "Seller not found"})
		}
		log.Printf("Error fetching seller for product creation: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to validate seller"})
	}
	sellerName := seller.Username
	// sellerName is NOT caller input — it came from the users row above. This
	// fallback covers an account with a blank username, and stays a default
	// because there is no caller to send an error to about it.
	if sellerName == "" {
		sellerName = "Unknown Seller"
	}

	// Fill the dropdown attributes Post an Ad pre-selects, so an API caller has
	// exactly the same required set as someone using the form: title, price,
	// location and dealingMethod. Runs BEFORE the check below, which therefore
	// only ever fires for the two the form itself refuses to invent.
	ApplyListingDefaults(&req)
	if missing := MissingListingFields(req); len(missing) > 0 {
		return c.JSON(400, map[string]string{"error": missing[0].Message})
	}
	// Location is inherited from the account, never taken from the request.
	if seller.Incomplete() {
		return c.JSON(400, map[string]string{"error": IncompleteProfileError})
	}
	canonicalState, canonicalDistrict, ok := geo.Resolve(seller.State, seller.District)
	if !ok {
		return c.JSON(400, map[string]string{"error": IncompleteProfileError})
	}

	listing := listingRow{
		SellerID:            sellerID,
		Title:               req.Title,
		Description:         req.Description,
		WeightCategory:      req.WeightCategory,
		FlexibilityCategory: req.FlexibilityCategory,
		BalanceCategory:     req.BalanceCategory,
		Price:               req.Price,
		OriginalPrice:       req.OriginalPrice,
		Location:            canonicalDistrict,
		State:               canonicalState,
		Image:               req.Image,
		SellerName:          sellerName,
		IsNew:               req.IsNew,
		IsFeatured:          req.IsFeatured,
		Status:              "active",
		Category:            req.Category,
		Condition:           req.Condition,
		DealingMethod:       req.DealingMethod,
		StockQuantity:       stockQuantity,
	}
	if err := createListingRow(h.gormDB, &listing); err != nil {
		log.Printf("Error creating product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create product"})
	}
	productID := listing.ID

	// fetch the full product again, from the provided productID
	product, err := fetchProductByID(sqlDB, productID)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Product created, but failed to fetch response"})
	}
	// backend return the created product object back to the frontend
	return c.JSON(201, product)
}

func (h *Handler) deleteProduct(c echo.Context) error {
	if err := rejectUnsupportedQueryParams(c, map[string]bool{}); err != nil {
		return err
	}
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "invalid product id"})
	}

	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Invalid authorization token"})
	}

	// status comes back with seller_id so the state check below costs no extra
	// round trip.
	sellerID, status, qErr := loadListingSellerAndStatus(h.gormDB, id)
	if errors.Is(qErr, gorm.ErrRecordNotFound) {
		return c.JSON(404, map[string]string{"error": "Product not found"})
	} else if qErr != nil {
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if sellerID != userID {
		return c.JSON(403, map[string]string{"error": "Forbidden: you do not own this listing"})
	}

	//  pending and sold cannot delete, only active and archived can delete
	if status == "pending" || status == "sold" {
		return c.JSON(409, map[string]string{
			"error": "A listing that is " + status + " cannot be deleted.",
		})
	}

	// Orders reference listings with ON DELETE RESTRICT so a delete can never
	// erase someone's purchase history. Check up front to answer with something
	// the seller can act on instead of a bare foreign-key failure.
	var orderCount int
	if err := sqlDB.QueryRow("SELECT COUNT(*) FROM orders WHERE listing_id = $1", id).Scan(&orderCount); err != nil {
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if orderCount > 0 {
		return c.JSON(409, map[string]string{
			"error": "This listing has orders and cannot be deleted.",
		})
	}

	if err := deleteListingByID(h.gormDB, id); err != nil {
		log.Printf("Error deleting product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to delete product"})
	}
	// The row is already gone and committed, so a cleanup failure must not turn
	// into an error the seller sees — it would claim the delete failed when it
	// succeeded. Log the orphaned files for an operator instead.
	if err := files.RemoveListingFileDirectory(id); err != nil {
		log.Printf("Product %d deleted but attachment cleanup failed: %v", id, err)
	}
	return c.JSON(200, map[string]string{"message": "Product deleted"})
}

// edit only if the caller owns the listing (shared by web and API-key update)

// updateTarget resolves which listing is being edited and who is asking.
//
// Like loadListingForUpdate below, it writes its own error response and returns
// errResponseWritten, so callers reduce to `if err != nil { return err }`.
func updateTarget(c echo.Context) (int, int, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		_ = c.JSON(400, map[string]string{"error": "invalid product id"})
		return 0, 0, errResponseWritten
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		_ = c.JSON(401, map[string]string{"error": "Invalid authorization token"})
		return 0, 0, errResponseWritten
	}
	return id, userID, nil
}

// loadListingForUpdate runs the three checks both update paths share: the row
// exists, the caller owns it, and its status permits editing at all.
//
// Ownership is checked against the authenticated caller, never against anything
// in the request body, so neither surface can edit someone else's listing.
func loadListingForUpdate(c echo.Context, sqlDB *sql.DB, id, userID int) (currentListing, error) {
	var cur currentListing
	qErr := sqlDB.QueryRow(
		`SELECT seller_id, title, description, price, location,
			category, weight_category, flexibility_category, balance_category,
			COALESCE(status, 'active'), stock_quantity
		 FROM listings WHERE id = $1`, id,
	).Scan(
		&cur.SellerID, &cur.Title, &cur.Description, &cur.Price,
		&cur.Location, &cur.Category, &cur.WeightCategory,
		&cur.FlexibilityCategory, &cur.BalanceCategory, &cur.Status,
		&cur.StockQuantity,
	)
	if qErr == sql.ErrNoRows {
		_ = c.JSON(404, map[string]string{"error": "Product not found"})
		return cur, errResponseWritten
	} else if qErr != nil {
		log.Printf("Error loading listing %d for update: %v", id, qErr)
		_ = c.JSON(500, map[string]string{"error": "Database error"})
		return cur, errResponseWritten
	}
	if cur.SellerID != userID {
		_ = c.JSON(403, map[string]string{"error": "Forbidden: you do not own this listing"})
		return cur, errResponseWritten
	}
	if cur.Status == "pending" {
		_ = c.JSON(409, map[string]string{
			"error": "This listing has an order awaiting delivery and cannot be edited. Complete or cancel the order first.",
		})
		return cur, errResponseWritten
	}
	if cur.Status == "sold" {
		_ = c.JSON(409, map[string]string{
			"error": "A sold listing cannot be edited. Create a new listing to sell another one.",
		})
		return cur, errResponseWritten
	}
	return cur, nil
}

// updateProduct backs PUT /api/v1/products/:id — the sell page's edit mode, and
// a whole-form replace: every field the page lets a seller change is written,
// including the four the old shared handler silently dropped (condition,
// dealingMethod, phoneNumber, originalPrice).
//
// The API-key surface has its own handler, updateProductForAPIKey.
func (h *Handler) updateProduct(c echo.Context) error {
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

	var req UpdateListingRequest
	if err := bindStrictJSON(c, &req); err != nil {
		return err
	}

	// loadListingForUpdate already covered existence, ownership and the
	// pending/sold guards. Same validation helpers createProduct uses, so an
	// edit is held to the same rules as a create.
	listing := req.asListing()
	ApplyListingDefaults(&listing)

	if strings.TrimSpace(listing.Title) == "" {
		return c.JSON(400, map[string]string{"error": "title is required"})
	}
	if listing.Price <= 0 {
		return c.JSON(400, map[string]string{"error": "price must be greater than 0"})
	}
	if listing.OriginalPrice != nil && *listing.OriginalPrice <= 0 {
		return c.JSON(400, map[string]string{"error": "originalPrice must be greater than 0 when set"})
	}
	// Absent keeps whatever the listing already had; 0 is allowed so a seller can
	// mark something out of stock without deleting it.
	stockQuantity := current.StockQuantity
	if listing.StockQuantity != nil {
		stockQuantity = *listing.StockQuantity
	}
	if stockQuantity < 0 {
		return c.JSON(400, map[string]string{"error": "stockQuantity cannot be negative"})
	}
	if missing := MissingListingFields(listing); len(missing) > 0 {
		return c.JSON(400, map[string]string{"error": missing[0].Message})
	}
	if problems := OutOfRangeListingFields(listing); len(problems) > 0 {
		return c.JSON(400, map[string]string{"error": problems[0].Message})
	}
	// An edit re-reads the account, so moving house updates the listings too.
	seller, err := LookupSellerProfile(h.gormDB, current.SellerID)
	if err != nil {
		log.Printf("Error fetching seller for listing %d: %v", id, err)
		return c.JSON(500, map[string]string{"error": "Failed to validate seller"})
	}
	if seller.Incomplete() {
		return c.JSON(400, map[string]string{"error": IncompleteProfileError})
	}
	canonicalState, canonicalDistrict, ok := geo.Resolve(seller.State, seller.District)
	if !ok {
		return c.JSON(400, map[string]string{"error": IncompleteProfileError})
	}

	// Status: settable only between the two states a seller owns. My Shop's
	// Archive and Republish are ordinary edits carrying a status
	// (my-ads/page.tsx handleSetStatus), so refusing it would leave both buttons
	// reporting success while changing nothing. 'sold'/'pending'/'completed'
	// belong to the order flow in modules/order and are never accepted here.
	status := current.Status
	if strings.TrimSpace(req.Status) != "" {
		status = strings.TrimSpace(req.Status)
		if status != "active" && status != "archived" {
			return c.JSON(400, map[string]string{"error": "status must be active or archived"})
		}
	}

	// Republishing only — omitting status must never move the listing, which is
	// what an "" -> "active" default used to do.
	if status == "active" && current.Status != "active" {
		// A listing sells once, whole. An archived sold item no longer says so
		// in its status, so only the order history can answer this.
		var completedOrders int
		if err := sqlDB.QueryRow(
			"SELECT COUNT(*) FROM orders WHERE listing_id = $1", id,
		).Scan(&completedOrders); err != nil {
			log.Printf("Error counting orders for listing %d: %v", id, err)
			return c.JSON(500, map[string]string{"error": "Database error"})
		}
		if completedOrders > 0 {
			return c.JSON(409, map[string]string{
				"error": "This listing has already sold and cannot be republished. Create a new listing instead.",
			})
		}
		// Nothing left to sell, so republishing would offer stock that is not
		// there. My Shop reads the status back and tells the seller.
		if stockQuantity == 0 {
			status = "sold"
		}
	}

	// Values come from `listing`, not `req`: that is the copy applyListingDefaults
	// ran over, so a blank category lands as "Others" and the racket specs are
	// cleared for non-Rackets categories.
	err = updateListingColumns(h.gormDB, id, map[string]interface{}{
		"title":                listing.Title,
		"description":          listing.Description,
		"price":                listing.Price,
		"original_price":       listing.OriginalPrice,
		"location":             canonicalDistrict,
		"state":                canonicalState,
		"category":             listing.Category,
		"condition":            listing.Condition,
		"dealing_method":       listing.DealingMethod,
		"weight_category":      listing.WeightCategory,
		"flexibility_category": listing.FlexibilityCategory,
		"balance_category":     listing.BalanceCategory,
		"status":               status,
		"stock_quantity":       stockQuantity,
		"updated_at":           gorm.Expr("CURRENT_TIMESTAMP"),
	})
	if err != nil {
		log.Printf("Error updating listing %d: %v", id, err)
		return c.JSON(500, map[string]string{"error": "Failed to update product"})
	}

	product, err := fetchProductByID(sqlDB, id)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to fetch updated product"})
	}
	return c.JSON(200, product)
}
