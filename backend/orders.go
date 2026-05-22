package main

import (
	"database/sql"
	"log"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type Order struct {
	ID            int       `json:"id"`
	BuyerID       int       `json:"buyerId"`
	SellerID      int       `json:"sellerId"`
	ListingID     int       `json:"listingId"`
	Quantity      int       `json:"quantity"`
	TotalPrice    float64   `json:"totalPrice"`
	Status        string    `json:"status"`
	PaymentMethod string    `json:"paymentMethod"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func getOrders(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// Retrieve authenticated user ID from JWT context
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	query := `SELECT id, buyer_id, seller_id, listing_id, quantity, total_price, status, payment_method, created_at, updated_at 
	          FROM orders 
	          WHERE buyer_id = $1 
	          ORDER BY id DESC`

	rows, err := sqlDB.Query(query, userID)
	if err != nil {
		log.Printf("Error querying user orders: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch orders"})
	}
	defer rows.Close()

	orders := []Order{}
	for rows.Next() {
		var o Order
		var paymentMethod sql.NullString
		err := rows.Scan(
			&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
			&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
		)
		if err != nil {
			log.Printf("Error scanning order: %v", err)
			continue
		}
		if paymentMethod.Valid {
			o.PaymentMethod = paymentMethod.String
		}
		orders = append(orders, o)
	}

	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning orders"})
	}

	return c.JSON(200, orders)
}

func getOrderByID(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// Retrieve authenticated user ID from JWT context
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	orderID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid order ID"})
	}

	query := `SELECT id, buyer_id, seller_id, listing_id, quantity, total_price, status, payment_method, created_at, updated_at 
	          FROM orders 
	          WHERE id = $1`

	var o Order
	var paymentMethod sql.NullString
	err = sqlDB.QueryRow(query, orderID).Scan(
		&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
		&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return c.JSON(404, map[string]string{"error": "Order not found"})
	} else if err != nil {
		log.Printf("Error querying order details: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch order details"})
	}

	if paymentMethod.Valid {
		o.PaymentMethod = paymentMethod.String
	}

	// Security: Only the buyer or the seller associated with the order can inspect it
	if o.BuyerID != userID && o.SellerID != userID {
		return c.JSON(403, map[string]string{"error": "Forbidden: you do not have permission to view this order"})
	}

	return c.JSON(200, o)
}
