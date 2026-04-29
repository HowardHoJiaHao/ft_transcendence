package main

import (
	"database/sql"
	"fmt" //input  and output printf
	"log" //logging things
	"strconv"
	
	//go standard rule is to separate std library and external. but not necessary
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type Product struct {
	ID                  int      `json:"id"`
	Title               string   `json:"title"`
	Price               float64  `json:"price"`
	OriginalPrice       *float64 `json:"originalPrice,omitempty"`
	Image               string   `json:"image"`
	WeightCategory      string   `json:"weightCategory"`
	FlexibilityCategory string   `json:"flexibilityCategory"`
	BalanceCategory     string   `json:"balanceCategory"`
	Location            string   `json:"location"`
	SellerId            int      `json:"sellerId"`
	SellerName          string   `json:"sellerName"`
	SellerAvatar        string   `json:"sellerAvatar"`
	Rating              float64  `json:"rating"`
	Reviews             int      `json:"reviews"`
	IsNew               bool     `json:"isNew"`
	IsFeatured          bool     `json:"isFeatured"`
	Description         string   `json:"description"`
}

type CreateProductRequest struct {
	SellerID            int      `json:"sellerId"`
	SellerName          string   `json:"sellerName"`
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

	if limit == "" {
		limit = "20"
	}
	if offset == "" {
		offset = "0"
	}

	limitInt, _ := strconv.Atoi(limit)
	offsetInt, _ := strconv.Atoi(offset)

	query := "SELECT id, title, price, original_price, image, weight_category, flexibility_category, balance_category, location, seller_id, seller_name, rating, reviews, is_new, is_featured, description FROM listings WHERE 1=1"
	var args []interface{}
	
	//the concept of sql injection is it want the full line with 1=1 OR as command. but by doing our parameterized way it separate commands and data. firslt, when it separate it doesnt take the full sentence as command. secondly, we already specify that 1=1 OR is a data and dont take it as command which translate to always true
	//so make query string(maybe) and args slice
	if len(weightCategory) > 0 {
		startPos := len(args) + 1
		placeholders := ""
		for i := range weightCategory {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += fmt.Sprintf("$%d", startPos + i)
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
			placeholders += fmt.Sprintf("$%d", startPos + i)
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
			placeholders += fmt.Sprintf("$%d", startPos + i)
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

	//add sorting
	if sortBy == "price-low" {
		query += " ORDER BY price ASC"
	} else if sortBy == "price-high" {
		query += " ORDER BY price DESC"
	} else if sortBy == "newest" {
		query += " ORDER BY is_new DESC, id DESC"
	} else if sortBy == "rating" {
		query += " ORDER BY rating DESC"
	} else {
		query += " ORDER BY is_featured DESC, id DESC"
	}

	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limitInt, offsetInt)

	rows, err := sqlDB.Query(query, args...) //rows is connection to table data. ... is a spread operator. it unpacks the slice to an individual things. w/o ... you have to write one by one. instead of passing slice you pass "heavy", "light"
	if err != nil {
		log.Printf("Error querying products: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch products"})
	}
	defer  rows.Close() // a correct way to close row cursor. to access database we need to create a cursor. not closing it after usage, will cause memory usage, leaks and connection pool usage. 

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

//extract the product from database result, check and give it in slice format suitable for golang
func scanProducts(rows *sql.Rows) ([]Product, error) {
	products := []Product{}
	for rows.Next() {
		var p Product
		err := rows.Scan(
			&p.ID,
			&p.Title,
			&p.Price,
			&p.OriginalPrice,
			&p.Image,
			&p.WeightCategory,
			&p.FlexibilityCategory,
			&p.BalanceCategory,
			&p.Location,
			&p.SellerId,
			&p.SellerName,
			&p.Rating,
			&p.Reviews,
			&p.IsNew,
			&p.IsFeatured,
			&p.Description,
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

	//check the id is even and id or not
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
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
	if req.Image == "" {
		req.Image = "https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop"
	}
	if req.Location == "" {
		req.Location = "Kuala Lumpur"
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

	insertQuery := `
		INSERT INTO listings (
			seller_id,
			title,
			description,
			weight_category,
			flexibility_category,
			balance_category,
			price,
			original_price,
			location,
			image,
			seller_name,
			is_new,
			is_featured,
			status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active')
		RETURNING id`

	var productID int
	err = sqlDB.QueryRow(
		insertQuery,
		req.SellerID,
		req.Title,
		req.Description,
		req.WeightCategory,
		req.FlexibilityCategory,
		req.BalanceCategory,
		req.Price,
		req.OriginalPrice,
		req.Location,
		req.Image,
		req.SellerName,
		req.IsNew,
		req.IsFeatured,
	).Scan(&productID)
	if err != nil {
		log.Printf("Error creating product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create product"})
	}

	product, err := fetchProductByID(sqlDB, productID)
	if err != nil {
		log.Printf("Error fetching created product: %v", err)
		return c.JSON(500, map[string]string{"error": "Product created, but failed to fetch response"})
	}

	return c.JSON(201, product)
}

func fetchProductByID(sqlDB *sql.DB, id int) (Product, error) {
	query := "SELECT id, title, price, original_price, image, weight_category, flexibility_category, balance_category, location, seller_id, seller_name, rating, reviews, is_new, is_featured, description FROM listings WHERE id = $1"

	var product Product
	err := sqlDB.QueryRow(query, id).Scan(
		&product.ID,
		&product.Title,
		&product.Price,
		&product.OriginalPrice,
		&product.Image,
		&product.WeightCategory,
		&product.FlexibilityCategory,
		&product.BalanceCategory,
		&product.Location,
		&product.SellerId,
		&product.SellerName,
		&product.Rating,
		&product.Reviews,
		&product.IsNew,
		&product.IsFeatured,
		&product.Description,
	)

	return product, err
}