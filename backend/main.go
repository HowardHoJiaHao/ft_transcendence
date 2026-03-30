package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"

	_ "github.com/lib/pq"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"transcendence/modules/user"
)

func main() {
	// Initialize database
	db, err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Create Echo instance
	e := echo.New()

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"http://localhost:3000", "http://localhost:*"},
		AllowMethods: []string{"GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"},
	}))

	// Routes
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(200, map[string]string{
			"status": "ok",
		})
	})

	e.GET("/api/v1/status", func(c echo.Context) error {
		return c.JSON(200, map[string]interface{}{
			"status": "running",
			"version": "1.0.0",
		})
	})

	// Product routes
	e.GET("/api/v1/products", func(c echo.Context) error {
		return getProducts(c, db)
	})

	e.GET("/api/v1/products/:id", func(c echo.Context) error {
		return getProductByID(c, db)
	})

	// User Module initialization
	userHandler := user.NewHandler(db)
	v1 := e.Group("/api/v1")
	userHandler.RegisterRoutes(v1)

	// Start server
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	e.Logger.Fatal(e.Start(":" + port))
}

func initDB() (*sql.DB, error) {
	dbUser := os.Getenv("DB_USER")
	if dbUser == "" {
		dbUser = "transcendence"
	}

	dbPassword := os.Getenv("DB_PASSWORD")
	if dbPassword == "" {
		dbPassword = "transcendence_pass"
	}

	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "localhost"
	}

	dbPort := os.Getenv("DB_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}

	dbName := os.Getenv("DB_NAME")
	if dbName == "" {
		dbName = "transcendence"
	}

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", 
		dbHost, dbPort, dbUser, dbPassword, dbName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}

	err = db.Ping()
	if err != nil {
		return nil, err
	}

	log.Println("Database connected successfully")
	return db, nil
}

// Product struct
type Product struct {
	ID            int     `json:"id"`
	Title         string  `json:"title"`
	Price         float64 `json:"price"`
	OriginalPrice *float64 `json:"originalPrice,omitempty"`
	Image         string  `json:"image"`
	Category      string  `json:"category"`
	Location      string  `json:"location"`
	Seller        string  `json:"seller"`
	Rating        float64 `json:"rating"`
	Reviews       int     `json:"reviews"`
	IsNew         bool    `json:"isNew"`
	IsFeatured    bool    `json:"isFeatured"`
	Description   string  `json:"description"`
}

// getProducts - fetch all products with optional filters
func getProducts(c echo.Context, db *sql.DB) error {
	category := c.QueryParam("category")
	search := c.QueryParam("search")
	sortBy := c.QueryParam("sort")
	limit := c.QueryParam("limit")
	offset := c.QueryParam("offset")

	if limit == "" {
		limit = "20"
	}
	if offset == "" {
		offset = "0"
	}

	limitInt, _ := strconv.Atoi(limit)
	offsetInt, _ := strconv.Atoi(offset)

	query := "SELECT id, title, price, original_price, image, category, location, seller_name, rating, reviews, is_new, is_featured, description FROM listings WHERE 1=1"

	var args []interface{}

	if category != "" && category != "All" {
		query += " AND category = ?"
		args = append(args, category)
	}

	if search != "" {
		query += " AND title LIKE ?"
		args = append(args, "%"+search+"%")
	}

	// Add sorting
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

	query += " LIMIT ? OFFSET ?"
	args = append(args, limitInt, offsetInt)

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying products: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch products"})
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var product Product
		err := rows.Scan(
			&product.ID,
			&product.Title,
			&product.Price,
			&product.OriginalPrice,
			&product.Image,
			&product.Category,
			&product.Location,
			&product.Seller,
			&product.Rating,
			&product.Reviews,
			&product.IsNew,
			&product.IsFeatured,
			&product.Description,
		)
		if err != nil {
			log.Printf("Error scanning product: %v", err)
			continue
		}
		products = append(products, product)
	}

	if products == nil {
		products = []Product{}
	}

	return c.JSON(200, map[string]interface{}{
		"products": products,
		"total":    len(products),
	})
}

// getProductByID - fetch a single product by ID
func getProductByID(c echo.Context, db *sql.DB) error {
	id := c.Param("id")

	query := "SELECT id, title, price, original_price, image, category, location, seller_name, rating, reviews, is_new, is_featured, description FROM listings WHERE id = ?"

	var product Product
	err := db.QueryRow(query, id).Scan(
		&product.ID,
		&product.Title,
		&product.Price,
		&product.OriginalPrice,
		&product.Image,
		&product.Category,
		&product.Location,
		&product.Seller,
		&product.Rating,
		&product.Reviews,
		&product.IsNew,
		&product.IsFeatured,
		&product.Description,
	)

	if err == sql.ErrNoRows {
		return c.JSON(404, map[string]string{"error": "Product not found"})
	} else if err != nil {
		log.Printf("Error querying product: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch product"})
	}

	return c.JSON(200, product)
}
