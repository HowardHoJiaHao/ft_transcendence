package order

import (
	"database/sql"
	"log"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/modules/user/notifications"
	"transcendence/myMiddleware"
)

type Handler struct {
	gormDB        *gorm.DB
	rawDB         *sql.DB
	Notifications *notifications.Service
	Stripe        *StripePaymentService
}

func NewHandler(gormDB *gorm.DB, rawDB *sql.DB, notifications *notifications.Service, stripe *StripePaymentService) *Handler {
	return &Handler{gormDB: gormDB, rawDB: rawDB, Notifications: notifications, Stripe: stripe}
}

func (h *Handler) RegisterRoutes(v1 *echo.Group) {
	protected := v1.Group("")
	protected.Use(myMiddleware.JWTAuth(h.rawDB))
	protected.POST("/orders", h.createOrdersWithServices) //checkout (meetup or stripe)
	protected.GET("/orders", h.getOrders) //purchases
	protected.PUT("/orders/:id/complete", h.completeOrderWithNotifications) //myshop, seller marks meetup/sales done
	protected.PUT("/orders/:id/cancel", h.cancelOrder) // my shop - seller/buyer candel pending
	protected.GET("/orders/:id", h.getOrderByID)
	protected.GET("/seller/orders", h.getSellerOrders) // my shop, profile/my-ads
}

type Order struct {
	ID            int       `json:"id"`
	BuyerID       int       `json:"buyerId"`
	SellerID      int       `json:"sellerId"`
	ListingID     int       `json:"listingId"`
	Quantity      int       `json:"quantity"`
	TotalPrice    float64   `json:"totalPrice"`
	Status        string    `json:"status"`
	PaymentMethod string    `json:"paymentMethod"`
	PaymentStatus string    `json:"paymentStatus,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type EnrichedOrder struct {
	Order
	ListingTitle                  string  `json:"listingTitle"`
	ListingImage                  string  `json:"listingImage"`
	ListingCategory               string  `json:"listingCategory"`
	ListingPrice                  float64 `json:"listingPrice"`
	SellerName                    string  `json:"sellerName,omitempty"`
	SellerPhone                   string  `json:"sellerPhone,omitempty"`
	BuyerUsername                 string  `json:"buyerUsername,omitempty"`
	BuyerEmail                    string  `json:"buyerEmail,omitempty"`
	BuyerAddress                  string  `json:"buyerAddress,omitempty"`
	RecommendationSurveySubmitted bool    `json:"recommendationSurveySubmitted"`
	ListingReviewSubmitted        bool    `json:"listingReviewSubmitted"`
}

type CreateOrderItemRequest struct {
	ListingID int `json:"listingId"`
	Quantity  int `json:"quantity"`
}

type CreateOrdersRequest struct {
	Items             []CreateOrderItemRequest `json:"items"`
	PaymentMethod     string                   `json:"paymentMethod"`
	CheckoutRequestID string                   `json:"checkoutRequestId,omitempty"`
}

type CreateOrdersResponse struct {
	Orders      []Order `json:"orders"`
	TotalPrice  float64 `json:"totalPrice"`
	CheckoutURL string  `json:"checkoutUrl,omitempty"`
}

// unused function
func createOrders(c echo.Context, gormDB *gorm.DB) error {
	h := &Handler{gormDB: gormDB}
	return h.createOrdersWithServices(c)
}

type pendingNotification struct {
	userID         int
	notificationID int64
}

// unused function
func createOrdersWithNotifications(
	c echo.Context,
	gormDB *gorm.DB,
	notificationService *notifications.Service,
) error {
	h := &Handler{gormDB: gormDB, Notifications: notificationService}
	return h.createOrdersWithServices(c)
}

func (h *Handler) createOrdersWithServices(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
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
	if paymentMethod != "meetup" && paymentMethod != "stripe" {
		return c.JSON(400, map[string]string{"error": "Unsupported payment method"})
	}
	if paymentMethod == "stripe" {
		if h.Stripe == nil {
			return c.JSON(503, map[string]string{"error": "Stripe sandbox checkout is not configured"})
		}
		response, checkoutErr := h.Stripe.CreateCheckout(
			c.Request().Context(),
			buyerID,
			req.Items,
			req.CheckoutRequestID,
		)
		if checkoutErr != nil {
			log.Printf("Stripe checkout failed with HTTP status %d", checkoutErr.Status)
			return c.JSON(checkoutErr.Status, map[string]string{"error": checkoutErr.Message})
		}
		return c.JSON(201, response)
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
		// Listings sell as a whole lot: the buyer takes the entire stock or
		// nothing. A seller wanting to sell smaller amounts splits the lot into
		// separate listings. This keeps a listing's life binary -- active or
		// sold -- with no partially-depleted middle state that never surfaces
		// on the seller's Sold tab.
		if item.Quantity != stockQuantity {
			return c.JSON(409, map[string]string{
				"error": "This listing must be bought in full",
			})
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

		// The whole lot is taken, so the listing leaves the marketplace -- but
		// it is only reserved, not sold. It becomes 'sold' when the seller
		// confirms delivery, so the Sold tab reflects completed handovers
		// rather than merely paid-for orders.
		remainingStock := 0
		listingStatus := "pending"
		if _, err = tx.Exec(`
			UPDATE listings
			SET stock_quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $3`,
			remainingStock, listingStatus, item.ListingID,
		); err != nil {
			log.Printf("Error updating listing stock: %v", err)
			return c.JSON(500, map[string]string{"error": "Failed to update listing stock"})
		}

		if h.Notifications != nil {
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
			notificationID, createErr := h.Notifications.Repo.CreateTx(
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
		h.Notifications.PublishByID(pending.userID, pending.notificationID)
	}

	return c.JSON(201, CreateOrdersResponse{
		Orders:     createdOrders,
		TotalPrice: checkoutTotal,
	})
}

func (h *Handler) getOrders(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
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
			COALESCE(l.price, 0), COALESCE(l.seller_name, ''),
			-- The listing's own contact number first, since that is what the
			-- seller published for this item; their account number is the
			-- fallback for a listing created without one.
			COALESCE(NULLIF(l.phone_number, ''), su.phone_no, ''),
			EXISTS (
				SELECT 1 FROM recommendation_training_feedback feedback
				WHERE feedback.order_id = o.id
			),
			EXISTS (
				SELECT 1 FROM listing_reviews review
				WHERE review.order_id = o.id
			),
			CASE
				WHEN p.status IN ('initializing', 'pending') THEN 'awaiting_payment'
				ELSE p.status
			END
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		LEFT JOIN users su ON su.id = o.seller_id
		LEFT JOIN payments p ON p.id = o.payment_id
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
		var paymentStatus sql.NullString
		err := rows.Scan(
			&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
			&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
			&o.ListingTitle, &o.ListingImage, &o.ListingCategory, &o.ListingPrice, &o.SellerName,
			&o.SellerPhone,
			&o.RecommendationSurveySubmitted,
			&o.ListingReviewSubmitted,
			&paymentStatus,
		)
		if err != nil {
			log.Printf("Error scanning order: %v", err)
			continue
		}
		if paymentMethod.Valid {
			o.PaymentMethod = paymentMethod.String
		}
		if paymentStatus.Valid {
			o.PaymentStatus = paymentStatus.String
		}
		orders = append(orders, o)
	}

	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning orders"})
	}

	return c.JSON(200, orders)
}

func (h *Handler) getSellerOrders(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
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
				CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.email, '') END,
				CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.address, '') END,
				CASE
					WHEN p.status IN ('initializing', 'pending') THEN 'awaiting_payment'
					ELSE p.status
				END
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		JOIN users u ON u.id = o.buyer_id
		LEFT JOIN payments p ON p.id = o.payment_id
		WHERE o.seller_id = $1 AND o.status = $2
			AND (COALESCE(o.payment_method, '') <> 'stripe' OR p.status = 'paid')
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
		var paymentStatus sql.NullString
		err := rows.Scan(
			&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
			&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
			&o.ListingTitle, &o.ListingImage, &o.ListingCategory, &o.ListingPrice, &o.SellerName,
			&o.BuyerUsername, &o.BuyerEmail, &o.BuyerAddress, &paymentStatus,
		)
		if err != nil {
			log.Printf("Error scanning seller order: %v", err)
			continue
		}
		if paymentMethod.Valid {
			o.PaymentMethod = paymentMethod.String
		}
		if paymentStatus.Valid {
			o.PaymentStatus = paymentStatus.String
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller orders"})
	}

	return c.JSON(200, map[string]interface{}{"orders": orders})
}

func completeOrder(c echo.Context, gormDB *gorm.DB) error {
	h := &Handler{gormDB: gormDB}
	return h.completeOrderWithNotifications(c)
}

func (h *Handler) completeOrderWithNotifications(c echo.Context) error {
	if h.Notifications == nil {
		return h.completeOrderWithoutNotifications(c)
	}

	sqlDB, err := h.gormDB.DB()
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
			AND (
				COALESCE(payment_method, '') <> 'stripe'
				OR EXISTS (
					SELECT 1 FROM payments
					WHERE payments.id = orders.payment_id AND payments.status = 'paid'
				)
			)
		RETURNING buyer_id, listing_id`,
		orderID, sellerID,
	).Scan(&buyerID, &listingID)
	if err == sql.ErrNoRows {
		return c.JSON(409, map[string]string{"error": "Order is not pending, Stripe payment is unpaid, or you do not own it"})
	}
	if err != nil {
		log.Printf("Error completing order: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}

	// Delivery confirmed, so the reserved listing is now genuinely sold.
	if _, err := tx.Exec(`
		UPDATE listings
		SET status = 'sold', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'pending'`,
		listingID,
	); err != nil {
		log.Printf("Error marking listing sold: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}

	var listingTitle string
	if err := tx.QueryRow(`SELECT title FROM listings WHERE id = $1`, listingID).Scan(&listingTitle); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to create order notification"})
	}
	actorID := sellerID
	resourceID := orderID
	notificationID, err := h.Notifications.Repo.CreateTx(
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
	h.Notifications.PublishByID(buyerID, notificationID)

	return c.JSON(200, map[string]string{"message": "Order marked as delivered"})
}

func (h *Handler) completeOrderWithoutNotifications(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
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

	// Completing an order and selling its listing has to be one unit of work,
	// or a crash between them leaves a delivered order against a listing still
	// showing as reserved.
	tx, err := sqlDB.Begin()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to start order update"})
	}
	defer tx.Rollback()

	var listingID int
	err = tx.QueryRow(`
		UPDATE orders
		SET status = 'completed', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND seller_id = $2 AND status = 'pending'
			AND (
				COALESCE(payment_method, '') <> 'stripe'
				OR EXISTS (
					SELECT 1 FROM payments
					WHERE payments.id = orders.payment_id AND payments.status = 'paid'
				)
			)
		RETURNING listing_id`,
		orderID, sellerID,
	).Scan(&listingID)
	if err == sql.ErrNoRows {
		return c.JSON(409, map[string]string{"error": "Order is not pending or you do not own it"})
	}
	if err != nil {
		log.Printf("Error completing order: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}

	if _, err := tx.Exec(`
		UPDATE listings
		SET status = 'sold', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'pending'`,
		listingID,
	); err != nil {
		log.Printf("Error marking listing sold: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}
	if err := tx.Commit(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to complete order"})
	}

	return c.JSON(200, map[string]string{"message": "Order marked as delivered"})
}

// cancelOrder releases a pending order and puts its listing back on sale.
//
// Without this there is no way out of the reserved state: checkout moves a
// listing to 'pending' with zero stock, and only delivery moved it on. A sale
// that falls through would otherwise strand the listing forever -- invisible to
// buyers, unsellable by its owner.
//
// Either party may cancel while the order is still pending; once delivered it
// is history and stays put.
func (h *Handler) cancelOrder(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	userID, ok := c.Get("userId").(int)
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

	var listingID int
	var quantity int
	err = tx.QueryRow(`
		UPDATE orders
		SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'pending' AND (buyer_id = $2 OR seller_id = $2)
		RETURNING listing_id, quantity`,
		orderID, userID,
	).Scan(&listingID, &quantity)
	if err == sql.ErrNoRows {
		return c.JSON(409, map[string]string{"error": "Order is not pending or you are not part of it"})
	}
	if err != nil {
		log.Printf("Error cancelling order: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to cancel order"})
	}

	// Give the lot back exactly as it was taken, so the listing returns to sale
	// with the quantity the buyer had reserved.
	if _, err := tx.Exec(`
		UPDATE listings
		SET status = 'active', stock_quantity = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2 AND status = 'pending'`,
		quantity, listingID,
	); err != nil {
		log.Printf("Error restoring listing after cancellation: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to cancel order"})
	}

	if err := tx.Commit(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to cancel order"})
	}

	return c.JSON(200, map[string]string{"message": "Order cancelled"})
}

func (h *Handler) getOrderByID(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
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

	query := `SELECT
				o.id, o.buyer_id, o.seller_id, o.listing_id, o.quantity,
				o.total_price, o.status, o.payment_method, o.created_at, o.updated_at,
				CASE
					WHEN p.status IN ('initializing', 'pending') THEN 'awaiting_payment'
					ELSE p.status
				END
			FROM orders o
			LEFT JOIN payments p ON p.id = o.payment_id
			WHERE o.id = $1`

	var o Order
	var paymentMethod sql.NullString
	var paymentStatus sql.NullString
	err = sqlDB.QueryRow(query, orderID).Scan(
		&o.ID, &o.BuyerID, &o.SellerID, &o.ListingID, &o.Quantity,
		&o.TotalPrice, &o.Status, &paymentMethod, &o.CreatedAt, &o.UpdatedAt,
		&paymentStatus,
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
	if paymentStatus.Valid {
		o.PaymentStatus = paymentStatus.String
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
