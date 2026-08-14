package main

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
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
	IsNew               bool      `json:"isNew"`
	IsFeatured          bool      `json:"isFeatured"`
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
	StockQuantity       *int     `json:"stockQuantity,omitempty"`
	Status              string   `json:"status"`
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

// listingSelectCols is the shared SELECT column list used in all product queries.
//
// Rating, review count and seller name are derived, not read from the columns
// of the same name on listings. Those columns are never maintained -- nothing
// in the backend writes listings.rating or listings.reviews, and a username
// change never rewrites listings.seller_name -- so reading them served stale
// values that disagreed with the review section on the product page. The
// listing_reviews table and the users row are the single sources of truth.
const listingSelectCols = `l.id, l.title, l.price, l.original_price, COALESCE(l.image, ''),
	COALESCE(l.category, 'Others'), COALESCE(l.condition, 'Second-hand (Used)'),
	COALESCE(l.dealing_method, ''), COALESCE(l.phone_number, ''),
	COALESCE(l.weight_category, ''), COALESCE(l.flexibility_category, ''), COALESCE(l.balance_category, ''),
	COALESCE(l.location, ''), l.seller_id, COALESCE(u.username, l.seller_name, ''), COALESCE(u.avatar_url, ''),
	ROUND(COALESCE(lr.avg_rating, 0), 1)::float8, COALESCE(lr.review_count, 0), l.is_new, l.is_featured,
	COALESCE(l.stock_quantity, 0), COALESCE(l.status, 'active'), COALESCE(l.views_count, 0),
	l.created_at, COALESCE(l.description, '')`

// listingFromClause pairs every listing with its seller and its live review
// aggregate. Kept next to listingSelectCols because the two must stay in step:
// the select list references both u and lr.
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
	if sortBy == "price-low" {
		query += " ORDER BY l.price ASC"
	} else if sortBy == "price-high" {
		query += " ORDER BY l.price DESC"
	} else if sortBy == "newest" {
		// Keep the live marketplace fresh: sold-out cards remain visible, but
		// they always follow listings that buyers can still purchase.
		query += " ORDER BY CASE WHEN l.status <> 'active' OR COALESCE(l.stock_quantity, 0) = 0 THEN 1 ELSE 0 END ASC, l.id DESC"
	} else if sortBy == "rating" {
		query += " ORDER BY COALESCE(lr.avg_rating, 0) DESC, l.id DESC"
	} else {
		query += " ORDER BY l.is_featured DESC, l.id DESC"
	}

	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limitInt, offsetInt)

	rows, err := sqlDB.Query(query, args...)
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

// recordListingView increments the listing's view counter and logs an analytics
// event, skipping the seller viewing their own listing to avoid inflating counts.
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

	var userIDArg interface{}
	if err == nil {
		userIDArg = viewerID
	}
	if _, err := sqlDB.Exec(
		"INSERT INTO analytics_events (user_id, event_type, listing_id) VALUES ($1, 'listing_viewed', $2)",
		userIDArg, listingID,
	); err != nil {
		log.Printf("Error logging listing_viewed event for listing %d: %v", listingID, err)
	}
}

// gormDB is an interface/middleman for golang to talk to the rawDB
// the flow
// Go function
//
//	↓ <- the gormDB lives here, wrapping te rawDB
//
// rawDB / sqlDB
//
//	↓
//
// pgx
//
//	↓
//
// PostgreSQL
func createProduct(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// error handling, if json malformed
	var req CreateProductRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request body"})
	}
	sellerID, ok := c.Get("userId").(int)
	if !ok || sellerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}
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
	sellerName, err := lookupUsername(gormDB, sellerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(404, map[string]string{"error": "Seller not found"})
		}
		log.Printf("Error fetching seller for product creation: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to validate seller"})
	}
	// fill up the missing blank if these are empty
	if sellerName == "" {
		sellerName = "Unknown Seller"
	}
	if req.Location == "" {
		req.Location = "Malaysia"
	}
	if req.WeightCategory == "" {
		req.WeightCategory = "4U"
	}
	if req.FlexibilityCategory == "" {
		req.FlexibilityCategory = "Medium Flex"
	}
	if req.BalanceCategory == "" {
		req.BalanceCategory = "Even Balance"
	}
	if req.Category == "" {
		req.Category = "Others"
	}
	if req.Condition == "" {
		req.Condition = "Second-hand (Used)"
	}
	if req.DealingMethod == "" {
		req.DealingMethod = "Meet Up"
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

	sellerID, qErr := loadListingSellerID(gormDB, id)
	if errors.Is(qErr, gorm.ErrRecordNotFound) {
		return c.JSON(404, map[string]string{"error": "Product not found"})
	} else if qErr != nil {
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if sellerID != userID {
		return c.JSON(403, map[string]string{"error": "Forbidden: you do not own this listing"})
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
			"error": "This listing has orders and cannot be deleted. Archive it instead.",
		})
	}

	if err := deleteListingByID(gormDB, id); err != nil {
		log.Printf("Error deleting product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to delete product"})
	}
	if err := removeListingFileDirectory(id); err != nil {
		log.Printf("Product %d deleted but attachment cleanup failed: %v", id, err)
	}
	if err := clearStoredListingImages(id); err != nil {
		log.Printf("Product %d deleted but legacy image cleanup failed: %v", id, err)
	}
	return c.JSON(200, map[string]string{"message": "Product deleted"})
}

func updateProduct(c echo.Context, gormDB *gorm.DB) error {
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

	sellerID, currentStockQuantity, qErr := loadListingSellerAndStock(gormDB, id)
	if errors.Is(qErr, gorm.ErrRecordNotFound) {
		return c.JSON(404, map[string]string{"error": "Product not found"})
	} else if qErr != nil {
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if sellerID != userID {
		return c.JSON(403, map[string]string{"error": "Forbidden: you do not own this listing"})
	}

	var req UpdateProductRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request body"})
	}
	if req.Title == "" {
		return c.JSON(400, map[string]string{"error": "title is required"})
	}
	if req.Price <= 0 {
		return c.JSON(400, map[string]string{"error": "price must be greater than 0"})
	}
	if req.Status == "" {
		req.Status = "active"
	}
	stockQuantity := currentStockQuantity
	if req.StockQuantity != nil {
		stockQuantity = *req.StockQuantity
	}
	if stockQuantity < 0 {
		return c.JSON(400, map[string]string{"error": "stockQuantity cannot be negative"})
	}
	if req.Status == "active" && stockQuantity == 0 {
		req.Status = "sold"
	}

	err = updateListingColumns(gormDB, id, map[string]interface{}{
		"title":                req.Title,
		"description":          req.Description,
		"price":                req.Price,
		"original_price":       req.OriginalPrice,
		"location":             req.Location,
		"category":             req.Category,
		"condition":            req.Condition,
		"dealing_method":       req.DealingMethod,
		"phone_number":         req.PhoneNumber,
		"weight_category":      req.WeightCategory,
		"flexibility_category": req.FlexibilityCategory,
		"balance_category":     req.BalanceCategory,
		"status":               req.Status,
		"stock_quantity":       stockQuantity,
		"updated_at":           gorm.Expr("CURRENT_TIMESTAMP"),
	})
	if err != nil {
		log.Printf("Error updating product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to update product"})
	}

	product, err := fetchProductByID(sqlDB, id)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to fetch updated product"})
	}
	return c.JSON(200, product)
}

func uploadListingImages(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	listingID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid listing id"})
	}

	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Invalid authorization token"})
	}

	sellerID, qErr := loadListingSellerID(gormDB, listingID)
	if errors.Is(qErr, gorm.ErrRecordNotFound) {
		return c.JSON(404, map[string]string{"error": "Listing not found"})
	} else if qErr != nil {
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if sellerID != userID {
		return c.JSON(403, map[string]string{"error": "Forbidden"})
	}

	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(400, map[string]string{"error": "invalid multipart form"})
	}
	files := form.File["images"]
	if len(files) == 0 {
		return c.JSON(400, map[string]string{"error": "no images provided"})
	}
	if len(files) > 6 {
		files = files[:6]
	}

	if err := os.MkdirAll("static/listings", 0755); err != nil {
		return c.JSON(500, map[string]string{"error": "failed to create storage directory"})
	}
	if err := clearStoredListingImages(listingID); err != nil {
		log.Printf("Error clearing old listing images: %v", err)
		return c.JSON(500, map[string]string{"error": "failed to replace existing images"})
	}

	mimeToExt := map[string]string{
		"image/jpeg": "jpg",
		"image/png":  "png",
		"image/webp": "webp",
	}
	var imageURLs []string

	for i, fh := range files {
		if fh.Size > maxListingImageSize {
			continue
		}
		f, ferr := fh.Open()
		if ferr != nil {
			continue
		}
		data, rerr := io.ReadAll(f)
		f.Close()
		if rerr != nil {
			continue
		}
		detected := http.DetectContentType(data)
		ext, ok := mimeToExt[detected]
		if !ok {
			continue
		}
		filename := fmt.Sprintf("%d_%d.%s", listingID, i, ext)
		if werr := os.WriteFile(path.Join("static/listings", filename), data, 0644); werr != nil {
			continue
		}
		imageURLs = append(imageURLs, "/static/listings/"+filename)
	}

	if len(imageURLs) == 0 {
		return c.JSON(400, map[string]string{"error": "no valid images were uploaded. Use JPG, PNG, or WEBP images up to 10MB each"})
	}

	if _, uerr := sqlDB.Exec(
		"UPDATE listings SET image=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2",
		imageURLs[0], listingID,
	); uerr != nil {
		log.Printf("Error updating primary image: %v", uerr)
	}

	return c.JSON(200, map[string]interface{}{
		"imageUrls":    imageURLs,
		"primaryImage": imageURLs[0],
	})
}

func getListingImages(c echo.Context, gormDB *gorm.DB) error {
	listingID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "invalid listing id"})
	}

	if _, statErr := os.Stat("static/listings"); statErr != nil {
		if os.IsNotExist(statErr) {
			return c.JSON(200, map[string]interface{}{"imageUrls": []string{}})
		}
		return c.JSON(500, map[string]string{"error": "failed to read storage directory"})
	}

	entries, err := os.ReadDir("static/listings")
	if err != nil {
		return c.JSON(500, map[string]string{"error": "failed to list images"})
	}

	type imageEntry struct {
		index int
		url   string
	}

	var images []imageEntry
	prefix := fmt.Sprintf("%d_", listingID)
	allowedExt := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".webp": true,
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		ext := strings.ToLower(path.Ext(name))
		if !allowedExt[ext] {
			continue
		}
		idxStr := strings.TrimSuffix(strings.TrimPrefix(name, prefix), ext)
		idx, convErr := strconv.Atoi(idxStr)
		if convErr != nil {
			continue
		}
		images = append(images, imageEntry{index: idx, url: "/static/listings/" + name})
	}

	sort.Slice(images, func(i, j int) bool { return images[i].index < images[j].index })
	imageUrls := make([]string, 0, len(images))
	for _, img := range images {
		imageUrls = append(imageUrls, img.url)
	}

	return c.JSON(200, map[string]interface{}{"imageUrls": imageUrls})
}

func clearStoredListingImages(listingID int) error {
	entries, err := os.ReadDir("static/listings")
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	prefix := fmt.Sprintf("%d_", listingID)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		if err := os.Remove(path.Join("static/listings", entry.Name())); err != nil {
			return err
		}
	}
	return nil
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
