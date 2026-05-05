package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
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
	Status              string   `json:"status"`
}

// listingSelectCols is the shared SELECT column list used in all product queries.
const listingSelectCols = `id, title, price, original_price, image,
	COALESCE(category, 'Others'), COALESCE(condition, 'Second-hand (Used)'),
	COALESCE(dealing_method, ''), COALESCE(phone_number, ''),
	weight_category, flexibility_category, balance_category,
	location, seller_id, seller_name, rating, reviews, is_new, is_featured,
	COALESCE(status, 'active'), COALESCE(views_count, 0), created_at, description`

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

	if limit == "" {
		limit = "20"
	}
	if offset == "" {
		offset = "0"
	}

	limitInt, _ := strconv.Atoi(limit)
	offsetInt, _ := strconv.Atoi(offset)

	query := "SELECT " + listingSelectCols + " FROM listings WHERE 1=1"
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
		query += " AND weight_category IN (" + placeholders + ")"
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
		query += " AND flexibility_category IN (" + placeholders + ")"
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
		query += " AND balance_category IN (" + placeholders + ")"
	}
	if search != "" {
		query += fmt.Sprintf(" AND title ILIKE $%d", len(args)+1)
		args = append(args, "%"+search+"%")
	}
	if sellerId != "" {
		sellerIdInt, err := strconv.Atoi(sellerId)
		if err == nil {
			query += fmt.Sprintf(" AND seller_id = $%d", len(args)+1)
			args = append(args, sellerIdInt)
		}
	}
	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", len(args)+1)
		args = append(args, status)
	}

	if sortBy == "price-low" {
		query += " ORDER BY price ASC"
	} else if sortBy == "price-high" {
		query += " ORDER BY price DESC"
	} else if sortBy == "newest" {
		query += " ORDER BY id DESC"
	} else if sortBy == "rating" {
		query += " ORDER BY rating DESC"
	} else {
		query += " ORDER BY is_featured DESC, id DESC"
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

	return c.JSON(200, map[string]interface{}{
		"products": products,
		"total":    len(products),
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
			&p.Location, &p.SellerId, &p.SellerName, &p.Rating, &p.Reviews,
			&p.IsNew, &p.IsFeatured, &p.Status, &p.ViewsCount, &p.CreatedAt, &p.Description,
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
	return c.JSON(200, product)
}

func createProduct(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	var req CreateProductRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request body"})
	}
	if req.SellerID <= 0 {
		return c.JSON(400, map[string]string{"error": "sellerId is required"})
	}
	if req.Title == "" {
		return c.JSON(400, map[string]string{"error": "title is required"})
	}
	if req.Price <= 0 {
		return c.JSON(400, map[string]string{"error": "price must be greater than 0"})
	}

	if req.SellerName == "" {
		req.SellerName = "Unknown Seller"
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

	insertQuery := `INSERT INTO listings (
		seller_id, title, description, weight_category, flexibility_category, balance_category,
		price, original_price, location, image, seller_name, is_new, is_featured, status,
		category, condition, dealing_method, phone_number
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,$16,$17)
	RETURNING id`

	var productID int
	err = sqlDB.QueryRow(insertQuery,
		req.SellerID, req.Title, req.Description, req.WeightCategory, req.FlexibilityCategory,
		req.BalanceCategory, req.Price, req.OriginalPrice, req.Location, req.Image, req.SellerName,
		req.IsNew, req.IsFeatured, req.Category, req.Condition, req.DealingMethod, req.PhoneNumber,
	).Scan(&productID)
	if err != nil {
		log.Printf("Error creating product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create product"})
	}

	product, err := fetchProductByID(sqlDB, productID)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Product created, but failed to fetch response"})
	}
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

	var sellerID int
	qErr := sqlDB.QueryRow("SELECT seller_id FROM listings WHERE id = $1", id).Scan(&sellerID)
	if qErr == sql.ErrNoRows {
		return c.JSON(404, map[string]string{"error": "Product not found"})
	} else if qErr != nil {
		return c.JSON(500, map[string]string{"error": "Database error"})
	}
	if sellerID != userID {
		return c.JSON(403, map[string]string{"error": "Forbidden: you do not own this listing"})
	}

	if _, err := sqlDB.Exec("DELETE FROM listings WHERE id = $1", id); err != nil {
		log.Printf("Error deleting product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to delete product"})
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

	var sellerID int
	qErr := sqlDB.QueryRow("SELECT seller_id FROM listings WHERE id = $1", id).Scan(&sellerID)
	if qErr == sql.ErrNoRows {
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

	_, err = sqlDB.Exec(`UPDATE listings SET
		title=$1, description=$2, price=$3, original_price=$4, location=$5,
		category=$6, condition=$7, dealing_method=$8, phone_number=$9,
		weight_category=$10, flexibility_category=$11, balance_category=$12,
		status=$13, updated_at=CURRENT_TIMESTAMP WHERE id=$14`,
		req.Title, req.Description, req.Price, req.OriginalPrice, req.Location,
		req.Category, req.Condition, req.DealingMethod, req.PhoneNumber,
		req.WeightCategory, req.FlexibilityCategory, req.BalanceCategory, req.Status, id)
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

	var sellerID int
	qErr := sqlDB.QueryRow("SELECT seller_id FROM listings WHERE id = $1", listingID).Scan(&sellerID)
	if qErr == sql.ErrNoRows {
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

	mimeToExt := map[string]string{
		"image/jpeg": "jpg",
		"image/png":  "png",
		"image/webp": "webp",
	}
	var imageURLs []string

	for i, fh := range files {
		if fh.Size > 2*1024*1024 {
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
		return c.JSON(400, map[string]string{"error": "no valid images were uploaded"})
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

func fetchProductByID(sqlDB *sql.DB, id int) (Product, error) {
	query := "SELECT " + listingSelectCols + " FROM listings WHERE id = $1"
	var p Product
	err := sqlDB.QueryRow(query, id).Scan(
		&p.ID, &p.Title, &p.Price, &p.OriginalPrice, &p.Image,
		&p.Category, &p.Condition, &p.DealingMethod, &p.PhoneNumber,
		&p.WeightCategory, &p.FlexibilityCategory, &p.BalanceCategory,
		&p.Location, &p.SellerId, &p.SellerName, &p.Rating, &p.Reviews,
		&p.IsNew, &p.IsFeatured, &p.Status, &p.ViewsCount, &p.CreatedAt, &p.Description,
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
