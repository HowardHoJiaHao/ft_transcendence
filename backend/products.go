package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type Product struct {
	ID                  int       `json:"id"`
	Title               string    `json:"title"`
	Price               float64   `json:"price"`
	OriginalPrice       *float64  `json:"originalPrice,omitempty"`
	Image               string    `json:"image"`
	Category            string    `json:"category"`
	Condition           string    `json:"condition"`
	DealingMethod       string    `json:"dealingMethod"`
	PhoneNumber         string    `json:"phoneNumber"`
	WeightCategory      string    `json:"weightCategory"`
	FlexibilityCategory string    `json:"flexibilityCategory"`
	BalanceCategory     string    `json:"balanceCategory"`
	Location            string    `json:"location"`
	SellerId            int       `json:"sellerId"`
	SellerName          string    `json:"sellerName"`
	SellerAvatar        string    `json:"sellerAvatar"`
	Rating              float64   `json:"rating"`
	Reviews             int       `json:"reviews"`
	IsNew               bool      `json:"-"`
	IsFeatured          bool      `json:"-"`
	StockQuantity       int       `json:"stockQuantity"`
	Status              string    `json:"status"`
	ViewsCount          int       `json:"viewsCount"`
	CreatedAt           time.Time `json:"createdAt"`
	Description         string    `json:"description"`
}

type CreateProductRequest struct {
	SellerID            int      `json:"sellerId"`
	SellerName          string   `json:"sellerName"`
	Category            string   `json:"category"`
	Condition           string   `json:"condition"`
	DealingMethod       string   `json:"dealingMethod"`
	PhoneNumber         string   `json:"phoneNumber"`
	Title               string   `json:"title"`
	Description         string   `json:"description"`
	WeightCategory      string   `json:"weightCategory"`
	FlexibilityCategory string   `json:"flexibilityCategory"`
	BalanceCategory     string   `json:"balanceCategory"`
	Price               float64  `json:"price"`
	OriginalPrice       *float64 `json:"originalPrice,omitempty"`
	Location            string   `json:"location"`
	Image               string   `json:"image"`
	IsNew               bool     `json:"isNew"`
	IsFeatured          bool     `json:"isFeatured"`
	StockQuantity       *int     `json:"stockQuantity,omitempty"`
}

type UpdateProductRequest struct {
	Title         *string  `json:"title"`
	Price         *float64 `json:"price"`
	Description   *string  `json:"description"`
	Category      *string  `json:"category"`
	Location      *string  `json:"location"`
	StockQuantity *int     `json:"stockQuantity,omitempty"`
}

const maxListingImageSize = 10 * 1024 * 1024

// listingRow is the listings table for GORM. Product stays the API/read model
// (joins and derived rating) and is not used for inserts.
type listingRow struct {
	ID                  int      `gorm:"primaryKey"`
	SellerID            int      `gorm:"column:seller_id"`
	Title               string   `gorm:"column:title"`
	Description         string   `gorm:"column:description"`
	WeightCategory      string   `gorm:"column:weight_category"`
	FlexibilityCategory string   `gorm:"column:flexibility_category"`
	BalanceCategory     string   `gorm:"column:balance_category"`
	Category            string   `gorm:"column:category"`
	Condition           string   `gorm:"column:condition"`
	DealingMethod       string   `gorm:"column:dealing_method"`
	PhoneNumber         string   `gorm:"column:phone_number"`
	Price               float64  `gorm:"column:price"`
	OriginalPrice       *float64 `gorm:"column:original_price"`
	Location            string   `gorm:"column:location"`
	Image               string   `gorm:"column:image"`
	SellerName          string   `gorm:"column:seller_name"`
	IsNew               bool     `gorm:"column:is_new"`
	IsFeatured          bool     `gorm:"column:is_featured"`
	StockQuantity       int      `gorm:"column:stock_quantity"`
	Status              string   `gorm:"column:status"`
}

func (listingRow) TableName() string { return "listings" }

type usernameRow struct {
	ID       int    `gorm:"primaryKey"`
	Username string `gorm:"column:username"`
}

func (usernameRow) TableName() string { return "users" }

func gormNoTx(db *gorm.DB) *gorm.DB {
	return db.Session(&gorm.Session{SkipDefaultTransaction: true})
}

func lookupUsername(db *gorm.DB, userID int) (string, error) {
	var row usernameRow
	err := db.Select("username").First(&row, userID).Error
	return row.Username, err
}

func loadListingSellerID(db *gorm.DB, listingID int) (int, error) {
	var row listingRow
	err := db.Select("seller_id").First(&row, listingID).Error
	return row.SellerID, err
}

func loadListingSellerAndStock(db *gorm.DB, listingID int) (int, int, error) {
	var row listingRow
	err := db.Select("seller_id", "stock_quantity").First(&row, listingID).Error
	return row.SellerID, row.StockQuantity, err
}

// loadListingSellerAndStatus reads the two things the delete path needs in one
// round trip: who owns the listing, and whether its state allows deletion.
//
// status is COALESCEd because the column is nullable on rows created before it
// existed, and listingRow.Status is a plain string that cannot scan a NULL.
func loadListingSellerAndStatus(db *gorm.DB, listingID int) (int, string, error) {
	var row listingRow
	err := db.Select("seller_id, COALESCE(status, 'active') AS status").First(&row, listingID).Error
	return row.SellerID, row.Status, err
}

func createListingRow(db *gorm.DB, row *listingRow) error {
	return gormNoTx(db).Select(
		"SellerID", "Title", "Description", "WeightCategory", "FlexibilityCategory",
		"BalanceCategory", "Price", "OriginalPrice", "Location", "Image", "SellerName",
		"IsNew", "IsFeatured", "Status", "Category", "Condition", "DealingMethod",
		"PhoneNumber", "StockQuantity",
	).Create(row).Error
}

func deleteListingByID(db *gorm.DB, id int) error {
	return gormNoTx(db).Delete(&listingRow{}, id).Error
}

func updateListingColumns(db *gorm.DB, id int, fields map[string]interface{}) error {
	return gormNoTx(db).Model(&listingRow{}).Where("id = ?", id).Updates(fields).Error
}

// listingSelectCols is the shared SELECT column list for all product queries.
//
// Rating, review count and seller name are derived rather than read from the
// like-named listings columns: nothing maintains those, so they served stale
// values. listing_reviews and the users row are the sources of truth.
const listingSelectCols = `l.id, l.title, l.price, l.original_price, COALESCE(l.image, ''),
	COALESCE(l.category, 'Others'), COALESCE(l.condition, 'Second-hand (Used)'),
	COALESCE(l.dealing_method, ''), COALESCE(l.phone_number, ''),
	COALESCE(l.weight_category, ''), COALESCE(l.flexibility_category, ''), COALESCE(l.balance_category, ''),
	COALESCE(l.location, ''), l.seller_id, COALESCE(u.username, l.seller_name, ''), COALESCE(u.avatar_url, ''),
	ROUND(COALESCE(lr.avg_rating, 0), 1)::float8, COALESCE(lr.review_count, 0),
	l.is_new, l.is_featured,
	COALESCE(l.stock_quantity, 0), COALESCE(l.status, 'active'), COALESCE(l.views_count, 0),
	l.created_at, COALESCE(l.description, '')`

// listingFromClause pairs every listing with its seller and its live review
// aggregate. Kept next to listingSelectCols because the two must stay in step:
// the select list references u and lr.
//
// The review aggregate is a LEFT JOINed subquery rather than a correlated
// scalar subselect, so a listing with no reviews still appears — it just
// arrives with NULLs the COALESCEs turn into zeroes.
const listingFromClause = ` FROM listings l
	LEFT JOIN users u ON l.seller_id = u.id
	LEFT JOIN (
		SELECT listing_id, COUNT(*) AS review_count, AVG(rating) AS avg_rating
		FROM listing_reviews
		GROUP BY listing_id
	) lr ON lr.listing_id = l.id`

// list all products with filters
func getProducts(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	weightCategory := c.QueryParams()["weightCategory"]
	flexibilityCategory := c.QueryParams()["flexibilityCategory"]
	balanceCategory := c.QueryParams()["balanceCategory"]
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
func getProductsForAPIKey(c echo.Context, gormDB *gorm.DB) error {
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

	return getProducts(c, gormDB)
}

// getProductByIDForAPIKey serves GET /api/public/v1/products/:id for listings
// the key's account owns, and 404s everything else.
//
// 404 rather than 403 for someone else's listing: answering both identically
// stops the endpoint being walked to discover which ids exist.
func getProductByIDForAPIKey(c echo.Context, gormDB *gorm.DB) error {
	if err := rejectUnsupportedQueryParams(c, map[string]bool{}); err != nil {
		return err
	}
	sqlDB, err := gormDB.DB()
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

	return getProductByID(c, gormDB)
}

func scanProducts(rows *sql.Rows) ([]Product, error) {
	products := []Product{}
	for rows.Next() {
		var p Product
		err := rows.Scan(
			&p.ID, &p.Title, &p.Price, &p.OriginalPrice, &p.Image,
			&p.Category, &p.Condition, &p.DealingMethod, &p.PhoneNumber,
			&p.WeightCategory, &p.FlexibilityCategory, &p.BalanceCategory,
			&p.Location, &p.SellerId, &p.SellerName, &p.SellerAvatar, &p.Rating, &p.Reviews,
			&p.IsNew, &p.IsFeatured, &p.StockQuantity, &p.Status, &p.ViewsCount, &p.CreatedAt, &p.Description,
		)
		if err != nil {
			log.Printf("Error scanning product: %v", err)
			continue
		}
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return products, nil
}

func getProductByID(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
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
	if uid, _, authErr := getOptionalJWTAuth(c, sqlDB); authErr != nil || uid <= 0 {
		product.PhoneNumber = ""
	}

	recordListingView(sqlDB, product.ID, product.SellerId, c)

	return c.JSON(200, product)
}

// if is own view or api call self product view it dont count and return
func recordListingView(sqlDB *sql.DB, listingID int, sellerID int, c echo.Context) {
	viewerID, err := extractUserID(c)
	if err == nil && viewerID == sellerID {
		return
	}

	if _, err := sqlDB.Exec(
		"UPDATE listings SET views_count = views_count + 1 WHERE id = $1", listingID,
	); err != nil {
		log.Printf("Error incrementing views_count for listing %d: %v", listingID, err)
	}
}

// listingFieldError names a listing attribute the caller failed to supply.
type listingFieldError struct {
	Field   string
	Message string
}

// What Post an Ad pre-selects, mirrored by hand from the useState initialisers
// in sell/page.tsx. Each value is a member of the matching list in
// lib/productOptions.ts — one outside those lists could never match the site's
// own filter chips.
const (
	defaultCategory            = "Others"
	defaultCondition           = "Second-hand (Used)"
	defaultWeightCategory      = "4U"
	defaultFlexibilityCategory = "Medium Flex"
	defaultBalanceCategory     = "Even Balance"
)

// clearNonRacketSpecFields blanks the racket-only specs on any other category,
// so a defaulted "4U" never lands on a listing that is not a racket — that
// would fabricate product data buyers then filter on.
func clearNonRacketSpecFields(category string, weightCategory, flexibilityCategory, balanceCategory *string) {
	if strings.EqualFold(strings.TrimSpace(category), "Rackets") {
		return
	}
	if weightCategory != nil {
		*weightCategory = ""
	}
	if flexibilityCategory != nil {
		*flexibilityCategory = ""
	}
	if balanceCategory != nil {
		*balanceCategory = ""
	}
}

// applyListingDefaults fills what the sell form pre-selects, so the API's
// required set matches the GUI's rather than exceeding it.
//
// location and dealingMethod are deliberately left out: the form pre-selects
// neither, and both are claims nobody made if invented. Bulk import calls this
// too via applyImportDefaults, so a blank CSV cell behaves like a blank field on
// a single-listing POST — both paths require the same four fields.
func applyListingDefaults(req *CreateProductRequest) {
	for _, field := range []struct {
		value    *string
		fallback string
	}{
		{&req.Category, defaultCategory},
		{&req.Condition, defaultCondition},
		{&req.WeightCategory, defaultWeightCategory},
		{&req.FlexibilityCategory, defaultFlexibilityCategory},
		{&req.BalanceCategory, defaultBalanceCategory},
	} {
		// TrimSpace so a whitespace-only value defaults too, matching the
		// blank check in missingListingFields that runs straight after.
		if strings.TrimSpace(*field.value) == "" {
			*field.value = field.fallback
		}
	}
	clearNonRacketSpecFields(req.Category, &req.WeightCategory, &req.FlexibilityCategory, &req.BalanceCategory)
}

// missingListingFields reports which caller-owned attributes were left empty.
// It defaults nothing itself: callers run applyListingDefaults first, so only
// location and dealingMethod can still be reported.
//
// Shared by createProduct and validateImportRow, so importing 100 listings is
// not a way around a check that creating one would have applied. TrimSpace so a
// CSV cell of only spaces counts as empty.
func missingListingFields(item CreateProductRequest) []listingFieldError {
	var missing []listingFieldError
	if strings.EqualFold(strings.TrimSpace(item.Category), "Rackets") {
		for _, field := range []struct{ name, value string }{
			{"weightCategory", item.WeightCategory},
			{"flexibilityCategory", item.FlexibilityCategory},
			{"balanceCategory", item.BalanceCategory},
		} {
			if strings.TrimSpace(field.value) == "" {
				missing = append(missing, listingFieldError{
					Field:   field.name,
					Message: field.name + " is required",
				})
			}
		}
	}
	for _, field := range []struct{ name, value string }{
		{"location", item.Location},
		{"category", item.Category},
		{"condition", item.Condition},
		{"dealingMethod", item.DealingMethod},
	} {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, listingFieldError{
				Field:   field.name,
				Message: field.name + " is required",
			})
		}
	}
	return missing
}

// Data path: handler → gormDB (wrapping sqlDB) → pgx → PostgreSQL.

// errResponseWritten reports that a helper already wrote the full response.
// Callers must return it immediately; Echo then sees the response as committed.
//
// A sentinel rather than c.JSON's return value, because c.JSON returns nil once
// it has written — so `return c.JSON(400, ...)` yielded a nil error and callers
// ran on past a rejected body, appending a second JSON document and, in
// updateProduct's case, doing the UPDATE anyway.
var errResponseWritten = errors.New("response already written")

func bindStrictJSON(c echo.Context, dest any) error {
	decoder := json.NewDecoder(c.Request().Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(dest)
	if err == nil {
		return nil
	}

	// NOTE: encoding/json saves an unknown-field error and keeps decoding, so
	// `dest` may be fully populated by the time this returns. That is exactly
	// why the caller must abort rather than trust the struct.
	message := "invalid request body"
	if err.Error() == "EOF" {
		message = "Invalid request body"
	} else if idx := strings.Index(err.Error(), "unknown field "); idx >= 0 {
		if name := strings.Trim(err.Error()[idx+len("unknown field "):], "\" "); name != "" {
			message = "invalid field: " + name
		}
	}
	_ = c.JSON(400, map[string]string{"error": message})
	return errResponseWritten
}

func createProduct(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// error handling, if json malformed
	var req CreateProductRequest
	if err := bindStrictJSON(c, &req); err != nil {
		return err
	}
	sellerID, ok := c.Get("userId").(int)
	if !ok || sellerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}
	req.Image = ""

	if req.Title == "" {
		return c.JSON(400, map[string]string{"error": "title is required"})
	}
	if req.Price <= 0 {
		return c.JSON(400, map[string]string{"error": "price must be greater than 0"})
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
	// Shared with products_import.go so a single-listing POST and a bulk import
	// resolve the seller's name the same way.
	sellerName, err := lookupUsername(gormDB, sellerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(404, map[string]string{"error": "Seller not found"})
		}
		log.Printf("Error fetching seller for product creation: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to validate seller"})
	}
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
	applyListingDefaults(&req)
	if missing := missingListingFields(req); len(missing) > 0 {
		return c.JSON(400, map[string]string{"error": missing[0].Message})
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
		Location:            req.Location,
		Image:               req.Image,
		SellerName:          sellerName,
		IsNew:               req.IsNew,
		IsFeatured:          req.IsFeatured,
		Status:              "active",
		Category:            req.Category,
		Condition:           req.Condition,
		DealingMethod:       req.DealingMethod,
		PhoneNumber:         req.PhoneNumber,
		StockQuantity:       stockQuantity,
	}
	if err := createListingRow(gormDB, &listing); err != nil {
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

func deleteProduct(c echo.Context, gormDB *gorm.DB) error {
	if err := rejectUnsupportedQueryParams(c, map[string]bool{}); err != nil {
		return err
	}
	sqlDB, err := gormDB.DB()
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
	sellerID, status, qErr := loadListingSellerAndStatus(gormDB, id)
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

	if err := deleteListingByID(gormDB, id); err != nil {
		log.Printf("Error deleting product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to delete product"})
	}
	// The row is already gone and committed, so a cleanup failure must not turn
	// into an error the seller sees — it would claim the delete failed when it
	// succeeded. Log the orphaned files for an operator instead.
	if err := removeListingFileDirectory(id); err != nil {
		log.Printf("Product %d deleted but attachment cleanup failed: %v", id, err)
	}
	return c.JSON(200, map[string]string{"message": "Product deleted"})
}

// currentListing is a row's pre-edit state. The API-key path overlays its six
// patchable fields onto it; the JWT path replaces the row outright and needs
// only SellerID and Status from it.
type currentListing struct {
	SellerID            int
	Status              string
	Title               string
	Description         string
	Category            string
	Location            string
	WeightCategory      string
	FlexibilityCategory string
	BalanceCategory     string
	Price               float64
	StockQuantity       int
}

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

// UpdateListingRequest is the sell page's edit payload — every field Post an Ad
// lets a seller change, plus status.
//
// Not UpdateProductRequest: that is the API-key surface's narrow patch, and
// while both routes shared it the edit form sent eight fields it did not
// recognise, so DisallowUnknownFields rejected every edit from the UI.
//
// Plain values, not pointers, because the form always submits whole. Only
// StockQuantity and OriginalPrice stay pointers, where absent differs from
// cleared.
type UpdateListingRequest struct {
	Title               string   `json:"title"`
	Price               float64  `json:"price"`
	Description         string   `json:"description"`
	Category            string   `json:"category"`
	Condition           string   `json:"condition"`
	DealingMethod       string   `json:"dealingMethod"`
	PhoneNumber         string   `json:"phoneNumber"`
	OriginalPrice       *float64 `json:"originalPrice"`
	Location            string   `json:"location"`
	WeightCategory      string   `json:"weightCategory"`
	FlexibilityCategory string   `json:"flexibilityCategory"`
	BalanceCategory     string   `json:"balanceCategory"`
	StockQuantity       *int     `json:"stockQuantity"`
	// Honoured, but only for active/archived — see the status block in
	// updateProduct. The form echoes the current value back on an ordinary edit.
	Status string `json:"status"`
}

// asListing reshapes the payload into the type the create-side validation
// helpers take, so an edit is held to the same rules as a create rather than to
// a second, drifting copy of them.
func (r UpdateListingRequest) asListing() CreateProductRequest {
	return CreateProductRequest{
		Title:               r.Title,
		Description:         r.Description,
		Price:               r.Price,
		OriginalPrice:       r.OriginalPrice,
		Location:            r.Location,
		Category:            r.Category,
		Condition:           r.Condition,
		DealingMethod:       r.DealingMethod,
		PhoneNumber:         r.PhoneNumber,
		WeightCategory:      r.WeightCategory,
		FlexibilityCategory: r.FlexibilityCategory,
		BalanceCategory:     r.BalanceCategory,
		StockQuantity:       r.StockQuantity,
	}
}

// updateProduct backs PUT /api/v1/products/:id — the sell page's edit mode, and
// a whole-form replace: every field the page lets a seller change is written,
// including the four the old shared handler silently dropped (condition,
// dealingMethod, phoneNumber, originalPrice).
//
// The API-key surface has its own handler, updateProductForAPIKey.
func updateProduct(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
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
	applyListingDefaults(&listing)

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
	if missing := missingListingFields(listing); len(missing) > 0 {
		return c.JSON(400, map[string]string{"error": missing[0].Message})
	}

	// Status: settable only between the two states a seller owns. My Shop's
	// Archive and Republish are ordinary edits carrying a status
	// (my-ads/page.tsx handleSetStatus), so refusing it would leave both buttons
	// reporting success while changing nothing. 'sold'/'pending'/'completed'
	// belong to the order flow in orders.go and are never accepted here.
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
	err = updateListingColumns(gormDB, id, map[string]interface{}{
		"title":                listing.Title,
		"description":          listing.Description,
		"price":                listing.Price,
		"original_price":       listing.OriginalPrice,
		"location":             listing.Location,
		"category":             listing.Category,
		"condition":            listing.Condition,
		"dealing_method":       listing.DealingMethod,
		"phone_number":         listing.PhoneNumber,
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

// updateProductForAPIKey backs PUT /api/public/v1/products/:id: a narrow
// partial patch of six fields, status not settable, omitted fields unchanged.
//
// Separate from the web form's handler on purpose — a key holder should not be
// able to rewrite the phone number buyers use to reach the seller.
func updateProductForAPIKey(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
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

func fetchProductByID(sqlDB *sql.DB, id int) (Product, error) {
	query := "SELECT " + listingSelectCols + listingFromClause + " WHERE l.id = $1"
	var p Product
	err := sqlDB.QueryRow(query, id).Scan(
		&p.ID, &p.Title, &p.Price, &p.OriginalPrice, &p.Image,
		&p.Category, &p.Condition, &p.DealingMethod, &p.PhoneNumber,
		&p.WeightCategory, &p.FlexibilityCategory, &p.BalanceCategory,
		&p.Location, &p.SellerId, &p.SellerName, &p.SellerAvatar, &p.Rating, &p.Reviews,
		&p.IsNew, &p.IsFeatured, &p.StockQuantity, &p.Status, &p.ViewsCount, &p.CreatedAt, &p.Description,
	)
	return p, err
}

// extractUserID pulls the numeric user ID from the "Bearer token_<id>" auth header.
func extractUserID(c echo.Context) (int, error) {
	auth := c.Request().Header.Get("Authorization")
	if auth == "" || !strings.HasPrefix(auth, "Bearer token_") {
		return 0, fmt.Errorf("Unauthorized")
	}
	return strconv.Atoi(strings.TrimPrefix(auth, "Bearer token_"))
}
