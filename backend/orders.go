package main

import (
	"database/sql"
	"log"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/modules/user/notifications"
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

type EnrichedOrder struct {
	Order
	ListingTitle    string  `json:"listingTitle"`
	ListingImage    string  `json:"listingImage"`
	ListingCategory string  `json:"listingCategory"`
	ListingPrice    float64 `json:"listingPrice"`
	SellerName      string  `json:"sellerName,omitempty"`
	BuyerUsername   string  `json:"buyerUsername,omitempty"`
	BuyerEmail      string  `json:"buyerEmail,omitempty"`
}

type CreateOrderItemRequest struct {
	ListingID int `json:"listingId"`
	Quantity  int `json:"quantity"`
}

type CreateOrdersRequest struct {
	Items         []CreateOrderItemRequest `json:"items"`
	PaymentMethod string                   `json:"paymentMethod"`
}

type CreateOrdersResponse struct {
	Orders     []Order `json:"orders"`
	TotalPrice float64 `json:"totalPrice"`
}

func createOrders(c echo.Context, gormDB *gorm.DB) error {
	return createOrdersWithNotifications(c, gormDB, nil)
}

type pendingNotification struct {
	userID         int
	notificationID int64
}

func createOrdersWithNotifications(
	c echo.Context,
	gormDB *gorm.DB,
	notificationService *notifications.Service,
) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	buyerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	var req CreateOrdersRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid request body"})
	}
	if len(req.Items) == 0 {
		return c.JSON(400, map[string]string{"error": "items cannot be empty"})
	}

	seenListings := map[int]bool{}
	for _, item := range req.Items {
		if item.ListingID <= 0 {
			return c.JSON(400, map[string]string{"error": "listingId must be valid"})
		}
		if item.Quantity <= 0 {
			return c.JSON(400, map[string]string{"error": "quantity must be greater than 0"})
		}
		if seenListings[item.ListingID] {
			return c.JSON(400, map[string]string{"error": "duplicate listingId in checkout"})
		}
		seenListings[item.ListingID] = true
	}

	paymentMethod := req.PaymentMethod
	if paymentMethod == "" {
		paymentMethod = "meetup"
	}

	tx, err := sqlDB.Begin()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to start checkout"})
	}
	defer tx.Rollback()

	createdOrders := []Order{}
	var checkoutTotal float64
	pendingNotifications := []pendingNotification{}

	for _, item := range req.Items {
		var sellerID int
		var price float64
		var status string
		var stockQuantity int

		err = tx.QueryRow(`
			SELECT seller_id, price, status, stock_quantity
			FROM listings
			WHERE id = $1
			FOR UPDATE`,
			item.ListingID,
		).Scan(&sellerID, &price, &status, &stockQuantity)
		if err == sql.ErrNoRows {
			return c.JSON(404, map[string]string{"error": "Listing not found"})
		}
		if err != nil {
			log.Printf("Error locking listing for checkout: %v", err)
			return c.JSON(500, map[string]string{"error": "Failed to validate listing"})
		}

		if sellerID == buyerID {
			return c.JSON(403, map[string]string{"error": "You cannot buy your own listing"})
		}
		if status != "active" {
			return c.JSON(409, map[string]string{"error": "Listing is not available"})
		}
		if stockQuantity < item.Quantity {
			return c.JSON(409, map[string]string{"error": "Insufficient stock for listing"})
		}

		totalPrice := price * float64(item.Quantity)
		var order Order
		err = tx.QueryRow(`
			INSERT INTO orders (
				buyer_id, seller_id, listing_id, quantity, total_price, status, payment_method
			)
			VALUES ($1, $2, $3, $4, $5, 'pending', $6)
			RETURNING id, buyer_id, seller_id, listing_id, quantity, total_price, status, payment_method, created_at, updated_at`,
			buyerID, sellerID, item.ListingID, item.Quantity, totalPrice, paymentMethod,
		).Scan(
			&order.ID, &order.BuyerID, &order.SellerID, &order.ListingID, &order.Quantity,
			&order.TotalPrice, &order.Status, &order.PaymentMethod, &order.CreatedAt, &order.UpdatedAt,
		)
		if err != nil {
			log.Printf("Error creating order: %v", err)
			return c.JSON(500, map[string]string{"error": "Failed to create order"})
		}

		remainingStock := stockQuantity - item.Quantity
		listingStatus := "active"
		if remainingStock == 0 {
			listingStatus = "sold"
		}
		if _, err = tx.Exec(`
			UPDATE listings
			SET stock_quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $3`,
			remainingStock, listingStatus, item.ListingID,
		); err != nil {
			log.Printf("Error updating listing stock: %v", err)
			return c.JSON(500, map[string]string{"error": "Failed to update listing stock"})
		}

		if notificationService != nil {
			var listingTitle string
			if err = tx.QueryRow(
				`SELECT title FROM listings WHERE id = $1`,
				item.ListingID,
			).Scan(&listingTitle); err != nil {
				log.Printf("Error reading listing title for notification: %v", err)
				return c.JSON(500, map[string]string{"error": "Failed to create order notification"})
			}
			actorID := buyerID
			resourceID := order.ID
			notificationID, createErr := notificationService.Repo.CreateTx(
				tx,
				sellerID,
				&actorID,
				notifications.TypeOrderNew,
				&resourceID,
				map[string]interface{}{
					"orderId":      order.ID,
					"listingId":    item.ListingID,
					"listingTitle": listingTitle,
					"quantity":     item.Quantity,
				},
			)
			if createErr != nil {
				log.Printf("Error creating order notification: %v", createErr)
				return c.JSON(500, map[string]string{"error": "Failed to create order notification"})
			}
			pendingNotifications = append(pendingNotifications, pendingNotification{
				userID:         sellerID,
				notificationID: notificationID,
			})
		}

		checkoutTotal += totalPrice
		createdOrders = append(createdOrders, order)
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Error committing checkout: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete checkout"})
	}
	for _, pending := range pendingNotifications {
		notificationService.PublishByID(pending.userID, pending.notificationID)
	}

	return c.JSON(201, CreateOrdersResponse{
		Orders:     createdOrders,
		TotalPrice: checkoutTotal,
	})
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

	status := c.QueryParam("status")
	if status != "" && !isValidOrderStatus(status) {
		return c.JSON(400, map[string]string{"error": "Invalid order status"})
	}

	query := `SELECT
			o.id, o.buyer_id, o.seller_id, o.listing_id, o.quantity, o.total_price,
			o.status, o.payment_method, o.created_at, o.updated_at,
			COALESCE(l.title, ''), COALESCE(l.image, ''), COALESCE(l.category, 'Others'),
			COALESCE(l.price, 0), COALESCE(l.seller_name, '')
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.buyer_id = $1`
	args := []interface{}{userID}
	if status != "" {
		query += " AND o.status = $2"
		args = append(args, status)
	}
	query += " ORDER BY o.id DESC"

	rows, err := sqlDB.Query(query, args...)
	if err != nil {
		log.Printf("Error querying user orders: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch orders"})
	}
	defer rows.Close()

	orders := []EnrichedOrder{}
	for rows.Next() {
		var o EnrichedOrder
		var paymentMethod sql.NullString
		err := rows.Scan(
			&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
			&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
			&o.ListingTitle, &o.ListingImage, &o.ListingCategory, &o.ListingPrice, &o.SellerName,
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

func getSellerOrders(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	status := c.QueryParam("status")
	if status == "" {
		status = "pending"
	}
	if !isValidOrderStatus(status) {
		return c.JSON(400, map[string]string{"error": "Invalid order status"})
	}

	rows, err := sqlDB.Query(`
		SELECT
			o.id, o.buyer_id, o.seller_id, o.listing_id, o.quantity, o.total_price,
			o.status, o.payment_method, o.created_at, o.updated_at,
			COALESCE(l.title, ''), COALESCE(l.image, ''), COALESCE(l.category, 'Others'),
			COALESCE(l.price, 0), COALESCE(l.seller_name, ''),
				CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted user' ELSE COALESCE(u.username, '') END,
				CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.email, '') END
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		JOIN users u ON u.id = o.buyer_id
		WHERE o.seller_id = $1 AND o.status = $2
		ORDER BY o.id DESC`,
		sellerID, status,
	)
	if err != nil {
		log.Printf("Error querying seller orders: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller orders"})
	}
	defer rows.Close()

	orders := []EnrichedOrder{}
	for rows.Next() {
		var o EnrichedOrder
		var paymentMethod sql.NullString
		err := rows.Scan(
			&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
			&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
			&o.ListingTitle, &o.ListingImage, &o.ListingCategory, &o.ListingPrice, &o.SellerName,
			&o.BuyerUsername, &o.BuyerEmail,
		)
		if err != nil {
			log.Printf("Error scanning seller order: %v", err)
			continue
		}
		if paymentMethod.Valid {
			o.PaymentMethod = paymentMethod.String
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller orders"})
	}

	return c.JSON(200, map[string]interface{}{"orders": orders})
}

func completeOrder(c echo.Context, gormDB *gorm.DB) error {
	return completeOrderWithNotifications(c, gormDB, nil)
}

func completeOrderWithNotifications(
	c echo.Context,
	gormDB *gorm.DB,
	notificationService *notifications.Service,
) error {
	if notificationService == nil {
		return completeOrderWithoutNotifications(c, gormDB)
	}

	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	orderID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid order ID"})
	}

	tx, err := sqlDB.Begin()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to start order update"})
	}
	defer tx.Rollback()

	var buyerID int
	var listingID int
	err = tx.QueryRow(`
		UPDATE orders
		SET status = 'completed', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND seller_id = $2 AND status = 'pending'
		RETURNING buyer_id, listing_id`,
		orderID, sellerID,
	).Scan(&buyerID, &listingID)
	if err == sql.ErrNoRows {
		return c.JSON(409, map[string]string{"error": "Order is not pending or you do not own it"})
	}
	if err != nil {
		log.Printf("Error completing order: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}

	var listingTitle string
	if err := tx.QueryRow(`SELECT title FROM listings WHERE id = $1`, listingID).Scan(&listingTitle); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to create order notification"})
	}
	actorID := sellerID
	resourceID := orderID
	notificationID, err := notificationService.Repo.CreateTx(
		tx,
		buyerID,
		&actorID,
		notifications.TypeOrderCompleted,
		&resourceID,
		map[string]interface{}{
			"orderId":      orderID,
			"listingId":    listingID,
			"listingTitle": listingTitle,
		},
	)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to create order notification"})
	}
	if err := tx.Commit(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}
	notificationService.PublishByID(buyerID, notificationID)

	return c.JSON(200, map[string]string{"message": "Order marked as delivered"})
}

func completeOrderWithoutNotifications(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	orderID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid order ID"})
	}

	result, err := sqlDB.Exec(`
		UPDATE orders
		SET status = 'completed', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND seller_id = $2 AND status = 'pending'`,
		orderID, sellerID,
	)
	if err != nil {
		log.Printf("Error completing order: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}
	if affected == 0 {
		return c.JSON(409, map[string]string{"error": "Order is not pending or you do not own it"})
	}

	return c.JSON(200, map[string]string{"message": "Order marked as delivered"})
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

func isValidOrderStatus(status string) bool {
	switch status {
	case "pending", "completed", "cancelled", "refunded":
		return true
	default:
		return false
	}
}
