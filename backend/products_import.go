package main

// Bulk product import.
// POST /api/v1/products/import (JWT) and /api/public/v1/products/import (API key)
// accept { "items": [CreateProductRequest, ...] } and create the listings
// all-or-nothing: every row is validated first, and if any row fails the
// whole request is rejected with per-row errors so the client can fix and retry.

import (
	"errors"
	"log"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Upper bound on rows per request so a single call cannot flood the table.
const maxImportRows = 500

type ImportProductsRequest struct {
	Items []CreateProductRequest `json:"items"`
}

// One validation failure, addressed to a row of the uploaded file.
type ImportRowError struct {
	Row     int    `json:"row"` // 1-based position inside items
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ImportProductsResponse struct {
	Imported int              `json:"imported"`
	IDs      []int            `json:"ids,omitempty"`
	Errors   []ImportRowError `json:"errors,omitempty"`
}

// validateImportRow mirrors the rules createProduct enforces on a single listing.
func validateImportRow(row int, item CreateProductRequest) []ImportRowError {
	var errs []ImportRowError
	if strings.TrimSpace(item.Title) == "" {
		errs = append(errs, ImportRowError{Row: row, Field: "title", Message: "title is required"})
	}
	if item.Price <= 0 {
		errs = append(errs, ImportRowError{Row: row, Field: "price", Message: "price must be greater than 0"})
	}
	if item.OriginalPrice != nil && *item.OriginalPrice <= 0 {
		errs = append(errs, ImportRowError{Row: row, Field: "originalPrice", Message: "originalPrice must be greater than 0 when set"})
	}
	if item.StockQuantity != nil && *item.StockQuantity < 1 {
		errs = append(errs, ImportRowError{Row: row, Field: "stockQuantity", Message: "stockQuantity must be at least 1"})
	}
	return errs
}

// applyImportDefaults fills the same fallbacks createProduct applies.
func applyImportDefaults(item *CreateProductRequest, sellerID int, sellerName string) {
	item.SellerID = sellerID
	item.SellerName = sellerName
	if item.Location == "" {
		item.Location = "Malaysia"
	}
	if item.WeightCategory == "" {
		item.WeightCategory = "4U"
	}
	if item.FlexibilityCategory == "" {
		item.FlexibilityCategory = "Medium Flex"
	}
	if item.BalanceCategory == "" {
		item.BalanceCategory = "Even Balance"
	}
	if item.Category == "" {
		item.Category = "Others"
	}
	if item.Condition == "" {
		item.Condition = "Second-hand (Used)"
	}
	if item.DealingMethod == "" {
		item.DealingMethod = "Meet Up"
	}
}

func importProducts(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// Listings always belong to the authenticated caller (JWT or API key).
	sellerID, ok := c.Get("userId").(int)
	if !ok || sellerID <= 0 {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	var req ImportProductsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request body"})
	}
	if len(req.Items) == 0 {
		return c.JSON(400, map[string]string{"error": "items cannot be empty"})
	}
	if len(req.Items) > maxImportRows {
		return c.JSON(400, map[string]string{"error": "too many items in one import (max 500)"})
	}

	// Default seller name for rows that do not carry one.
	sellerName := "Unknown Seller"
	if name, err := lookupUsername(gormDB, sellerID); err == nil {
		sellerName = name
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("Error looking up seller name for import: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to validate seller"})
	}

	// Phase 1: validate every row before touching the database.
	var rowErrors []ImportRowError
	for i, item := range req.Items {
		rowErrors = append(rowErrors, validateImportRow(i+1, item)...)
	}
	if len(rowErrors) > 0 {
		return c.JSON(400, ImportProductsResponse{Imported: 0, Errors: rowErrors})
	}

	// Phase 2: insert everything inside one transaction — either the whole
	// file is imported or none of it is.
	tx, err := sqlDB.Begin()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to start import"})
	}
	defer tx.Rollback()

	insertQuery := `INSERT INTO listings (
		seller_id, title, description, weight_category, flexibility_category, balance_category,
		price, original_price, location, image, seller_name, is_new, is_featured, status,
		category, condition, dealing_method, phone_number, stock_quantity
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,$16,$17,$18)
	RETURNING id`

	ids := make([]int, 0, len(req.Items))
	for i := range req.Items {
		item := req.Items[i]
		applyImportDefaults(&item, sellerID, sellerName)
		stockQuantity := 1
		if item.StockQuantity != nil {
			stockQuantity = *item.StockQuantity
		}

		var productID int
		if err := tx.QueryRow(insertQuery,
			item.SellerID, item.Title, item.Description, item.WeightCategory, item.FlexibilityCategory,
			item.BalanceCategory, item.Price, item.OriginalPrice, item.Location, item.Image, item.SellerName,
			item.IsNew, item.IsFeatured, item.Category, item.Condition, item.DealingMethod, item.PhoneNumber,
			stockQuantity,
		).Scan(&productID); err != nil {
			log.Printf("Error importing product (row %d): %v", i+1, err)
			return c.JSON(500, map[string]string{"error": "Failed to import products"})
		}
		ids = append(ids, productID)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Error committing product import: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete import"})
	}

	return c.JSON(201, ImportProductsResponse{Imported: len(ids), IDs: ids})
}
