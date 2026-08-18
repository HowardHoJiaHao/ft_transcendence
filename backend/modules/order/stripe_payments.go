package order

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"math"
	"net/mail"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v85"
)

const (
	stripeCurrency          = "myr"
	stripeSessionLifetime   = 30 * time.Minute
	stripeCheckoutKeyPrefix = "marketplace-checkout-"
)

type StripeConfig struct {
	SecretKey          string
	ConnectedAccountID string
	SellerEmail        string
	WebhookSecret      string
	SuccessURL         string
	CancelURL          string
}

func LoadStripeConfigFromEnv() StripeConfig {
	return StripeConfig{
		SecretKey:          strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		ConnectedAccountID: strings.TrimSpace(os.Getenv("STRIPE_TEST_CONNECTED_ACCOUNT_ID")),
		SellerEmail:        strings.TrimSpace(os.Getenv("STRIPE_TEST_SELLER_EMAIL")),
		WebhookSecret:      strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		SuccessURL:         strings.TrimSpace(os.Getenv("STRIPE_SUCCESS_URL")),
		CancelURL:          strings.TrimSpace(os.Getenv("STRIPE_CANCEL_URL")),
	}
}

func (c StripeConfig) validateCheckout() error {
	switch {
	case !strings.HasPrefix(c.SecretKey, "sk_test_"):
		return errors.New("STRIPE_SECRET_KEY must be a test-mode key")
	case !strings.HasPrefix(c.ConnectedAccountID, "acct_"):
		return errors.New("STRIPE_TEST_CONNECTED_ACCOUNT_ID is invalid")
	case !validStripeSellerEmail(c.SellerEmail):
		return errors.New("STRIPE_TEST_SELLER_EMAIL must be a valid email address")
	case !strings.HasPrefix(c.WebhookSecret, "whsec_"):
		return errors.New("STRIPE_WEBHOOK_SECRET is not configured")
	case !validStripeReturnURL(c.SuccessURL):
		return errors.New("STRIPE_SUCCESS_URL must be an HTTPS URL")
	case !validStripeReturnURL(c.CancelURL):
		return errors.New("STRIPE_CANCEL_URL must be an HTTPS URL")
	default:
		return nil
	}
}

func validStripeSellerEmail(value string) bool {
	value = strings.TrimSpace(value)
	at := strings.LastIndex(value, "@")
	if at <= 0 || at == len(value)-1 || !strings.Contains(value[at+1:], ".") {
		return false
	}
	address, err := mail.ParseAddress(value)
	return err == nil && strings.EqualFold(address.Address, value)
}

func validStripeReturnURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

type StripeCheckoutLineItem struct {
	ListingID      int
	Name           string
	UnitAmount     int64
	Quantity       int64
	LineTotalMinor int64
}

type StripeCheckoutSessionRequest struct {
	PaymentID        int64
	BuyerID          int
	SellerID         int
	AmountMinor      int64
	PlatformFeeMinor int64
	ConnectedAccount string
	SuccessURL       string
	CancelURL        string
	ExpiresAt        time.Time
	IdempotencyKey   string
	LineItems        []StripeCheckoutLineItem
}

type StripeCheckoutSession struct {
	ID        string
	URL       string
	ExpiresAt time.Time
	LiveMode  bool
}

type StripeCheckoutClient interface {
	CreateCheckoutSession(context.Context, StripeCheckoutSessionRequest) (*StripeCheckoutSession, error)
	ExpireCheckoutSession(context.Context, string) error
}

type realStripeCheckoutClient struct {
	client *stripe.Client
}

func NewRealStripeCheckoutClient(secretKey string) StripeCheckoutClient {
	if secretKey == "" {
		return nil
	}
	return &realStripeCheckoutClient{client: stripe.NewClient(secretKey)}
}

func (c *realStripeCheckoutClient) CreateCheckoutSession(
	ctx context.Context,
	request StripeCheckoutSessionRequest,
) (*StripeCheckoutSession, error) {
	metadata := map[string]string{
		"payment_id": strconv.FormatInt(request.PaymentID, 10),
		"buyer_id":   strconv.Itoa(request.BuyerID),
		"seller_id":  strconv.Itoa(request.SellerID),
	}
	lineItems := make([]*stripe.CheckoutSessionCreateLineItemParams, 0, len(request.LineItems))
	for _, item := range request.LineItems {
		lineItems = append(lineItems, &stripe.CheckoutSessionCreateLineItemParams{
			PriceData: &stripe.CheckoutSessionCreateLineItemPriceDataParams{
				Currency:   stripe.String(stripeCurrency),
				UnitAmount: stripe.Int64(item.UnitAmount),
				ProductData: &stripe.CheckoutSessionCreateLineItemPriceDataProductDataParams{
					Name: stripe.String(item.Name),
					Metadata: map[string]string{
						"listing_id": strconv.Itoa(item.ListingID),
					},
				},
			},
			Quantity: stripe.Int64(item.Quantity),
		})
	}

	params := &stripe.CheckoutSessionCreateParams{
		CancelURL:         stripe.String(request.CancelURL),
		ClientReferenceID: stripe.String(strconv.FormatInt(request.PaymentID, 10)),
		Currency:          stripe.String(stripeCurrency),
		ExpiresAt:         stripe.Int64(request.ExpiresAt.Unix()),
		LineItems:         lineItems,
		Metadata:          metadata,
		Mode:              stripe.String(stripe.CheckoutSessionModePayment),
		PaymentIntentData: &stripe.CheckoutSessionCreatePaymentIntentDataParams{
			ApplicationFeeAmount: stripe.Int64(request.PlatformFeeMinor),
			Metadata:             metadata,
			TransferData: &stripe.CheckoutSessionCreatePaymentIntentDataTransferDataParams{
				Destination: stripe.String(request.ConnectedAccount),
			},
		},
		PaymentMethodTypes: []*string{stripe.String(string(stripe.PaymentMethodTypeCard))},
		SuccessURL:         stripe.String(request.SuccessURL),
	}
	params.SetIdempotencyKey(request.IdempotencyKey)

	session, err := c.client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return nil, err
	}
	return &StripeCheckoutSession{
		ID:        session.ID,
		URL:       session.URL,
		ExpiresAt: time.Unix(session.ExpiresAt, 0).UTC(),
		LiveMode:  session.Livemode,
	}, nil
}

func (c *realStripeCheckoutClient) ExpireCheckoutSession(ctx context.Context, sessionID string) error {
	_, err := c.client.V1CheckoutSessions.Expire(ctx, sessionID, &stripe.CheckoutSessionExpireParams{})
	return err
}

type checkoutHTTPError struct {
	Status  int
	Message string
	Err     error
}

func (e *checkoutHTTPError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

type StripePaymentService struct {
	db     *sql.DB
	config StripeConfig
	client StripeCheckoutClient
	now    func() time.Time
}

func NewStripePaymentService(db *sql.DB, config StripeConfig, client StripeCheckoutClient) *StripePaymentService {
	return &StripePaymentService{
		db:     db,
		config: config,
		client: client,
		now:    time.Now,
	}
}

func NewStripePaymentServiceFromEnv(db *sql.DB) *StripePaymentService {
	config := LoadStripeConfigFromEnv()
	return NewStripePaymentService(db, config, NewRealStripeCheckoutClient(config.SecretKey))
}

type stripePaymentRecord struct {
	ID                  int64
	BuyerID             int
	SellerID            int
	AmountMinor         int64
	PlatformFeeMinor    int64
	Currency            string
	Status              string
	IdempotencyKey      string
	CheckoutSessionID   string
	CheckoutURL         string
	SessionExpiresAt    time.Time
	StockReleased       bool
	StripePaymentIntent string
}

type stripeCheckoutReservation struct {
	Payment stripePaymentRecord
	Orders  []Order
	Items   []StripeCheckoutLineItem
}

func (s *StripePaymentService) CreateCheckout(
	ctx context.Context,
	buyerID int,
	items []CreateOrderItemRequest,
	checkoutRequestID string,
) (CreateOrdersResponse, *checkoutHTTPError) {
	if s == nil || s.db == nil || s.client == nil {
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  503,
			Message: "Stripe sandbox checkout is not configured",
		}
	}
	if err := s.config.validateCheckout(); err != nil {
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  503,
			Message: "Stripe sandbox checkout is not configured",
			Err:     err,
		}
	}
	parsedRequestID, err := uuid.Parse(checkoutRequestID)
	if err != nil {
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  400,
			Message: "checkoutRequestId must be a valid UUID",
		}
	}
	checkoutRequestID = parsedRequestID.String()

	existing, err := s.loadExistingReservation(ctx, checkoutRequestID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CreateOrdersResponse{}, databaseCheckoutError(err)
	}
	if err == nil {
		return s.resumeCheckout(ctx, buyerID, existing)
	}

	reservation, checkoutErr := s.reserveCheckout(ctx, buyerID, items, checkoutRequestID)
	if checkoutErr != nil {
		return CreateOrdersResponse{}, checkoutErr
	}
	if reservation.Payment.BuyerID != buyerID {
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  409,
			Message: "checkoutRequestId is already in use",
		}
	}
	if reservation.Payment.Status != "initializing" {
		return s.resumeCheckout(ctx, buyerID, reservation)
	}
	return s.createProviderSession(ctx, reservation)
}

func (s *StripePaymentService) reserveCheckout(
	ctx context.Context,
	buyerID int,
	requestItems []CreateOrderItemRequest,
	checkoutRequestID string,
) (*stripeCheckoutReservation, *checkoutHTTPError) {
	items := append([]CreateOrderItemRequest(nil), requestItems...)
	sort.Slice(items, func(i, j int) bool { return items[i].ListingID < items[j].ListingID })

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, databaseCheckoutError(err)
	}
	defer tx.Rollback()

	lineItems := make([]StripeCheckoutLineItem, 0, len(items))
	var sellerID int
	var sellerEmail string
	var amountMinor int64
	type lockedItem struct {
		request CreateOrderItemRequest
		seller  int
		unit    int64
	}
	locked := make([]lockedItem, 0, len(items))

	for index, item := range items {
		var itemSellerID int
		var itemSellerEmail string
		var unitAmountMinor int64
		var status string
		var stockQuantity int
		err = tx.QueryRowContext(ctx, `
			SELECT l.seller_id, u.email, ROUND(l.price * 100)::BIGINT,
				l.status, l.stock_quantity
			FROM listings l
			JOIN users u ON u.id = l.seller_id
			WHERE l.id = $1
			FOR UPDATE OF l`,
			item.ListingID,
		).Scan(
			&itemSellerID,
			&itemSellerEmail,
			&unitAmountMinor,
			&status,
			&stockQuantity,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &checkoutHTTPError{Status: 404, Message: "Listing not found"}
		}
		if err != nil {
			return nil, databaseCheckoutError(err)
		}
		if itemSellerID == buyerID {
			return nil, &checkoutHTTPError{Status: 403, Message: "You cannot buy your own listing"}
		}
		if status != "active" {
			return nil, &checkoutHTTPError{Status: 409, Message: "Listing is not available"}
		}
		// Listings sell as a whole lot on every payment path, so this mirrors the
		// meetup rule in createOrders: the buyer takes the entire stock or
		// nothing. Allowing Stripe to take a slice would leave a
		// partially-depleted listing that never surfaces on the Sold tab, and
		// would let one listing accumulate several completed orders.
		if item.Quantity != stockQuantity {
			return nil, &checkoutHTTPError{
				Status:  409,
				Message: "This listing must be bought in full",
			}
		}
		if unitAmountMinor <= 0 || int64(item.Quantity) > math.MaxInt64/unitAmountMinor {
			return nil, &checkoutHTTPError{Status: 400, Message: "Listing amount is invalid"}
		}
		if index == 0 {
			sellerID = itemSellerID
			sellerEmail = itemSellerEmail
		} else if itemSellerID != sellerID {
			return nil, &checkoutHTTPError{
				Status:  409,
				Message: "Stripe checkout supports items from one seller only",
			}
		}
		lineTotal := unitAmountMinor * int64(item.Quantity)
		if amountMinor > math.MaxInt64-lineTotal {
			return nil, &checkoutHTTPError{Status: 400, Message: "Checkout amount is too large"}
		}
		amountMinor += lineTotal
		locked = append(locked, lockedItem{
			request: item,
			seller:  itemSellerID,
			unit:    unitAmountMinor,
		})
		lineItems = append(lineItems, StripeCheckoutLineItem{
			ListingID:      item.ListingID,
			Name:           fmt.Sprintf("Marketplace listing #%d", item.ListingID),
			UnitAmount:     unitAmountMinor,
			Quantity:       int64(item.Quantity),
			LineTotalMinor: lineTotal,
		})
	}

	if !strings.EqualFold(
		strings.TrimSpace(sellerEmail),
		strings.TrimSpace(s.config.SellerEmail),
	) {
		return nil, &checkoutHTTPError{
			Status:  403,
			Message: "Stripe sandbox payment is available only for the configured demo seller",
		}
	}

	platformFeeMinor := (amountMinor + 5) / 10
	idempotencyKey := stripeCheckoutKeyPrefix + checkoutRequestID
	expiresAt := s.now().UTC().Add(stripeSessionLifetime).Truncate(time.Second)
	var paymentID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO payments (
			checkout_request_id, stripe_idempotency_key, buyer_id, seller_id,
			provider, currency, amount_minor, platform_fee_minor, status,
			session_expires_at
		)
		VALUES ($1, $2, $3, $4, 'stripe', 'myr', $5, $6, 'initializing', $7)
		ON CONFLICT (checkout_request_id) DO NOTHING
		RETURNING id`,
		checkoutRequestID, idempotencyKey, buyerID, sellerID,
		amountMinor, platformFeeMinor, expiresAt,
	).Scan(&paymentID)
	if errors.Is(err, sql.ErrNoRows) {
		if rollbackErr := tx.Rollback(); rollbackErr != nil {
			return nil, databaseCheckoutError(rollbackErr)
		}
		existing, loadErr := s.loadExistingReservation(ctx, checkoutRequestID)
		if loadErr != nil {
			return nil, databaseCheckoutError(loadErr)
		}
		return existing, nil
	}
	if err != nil {
		return nil, databaseCheckoutError(err)
	}

	orders := make([]Order, 0, len(locked))
	for index, item := range locked {
		lineTotal := lineItems[index].LineTotalMinor
		var order Order
		err = tx.QueryRowContext(ctx, `
			INSERT INTO orders (
				buyer_id, seller_id, listing_id, quantity, total_price,
				status, payment_method, payment_id
			)
			VALUES ($1, $2, $3, $4, $5, 'pending', 'stripe', $6)
			RETURNING id, buyer_id, seller_id, listing_id, quantity, total_price,
				status, payment_method, created_at, updated_at`,
			buyerID, item.seller, item.request.ListingID, item.request.Quantity,
			minorUnitsDecimal(lineTotal), paymentID,
		).Scan(
			&order.ID, &order.BuyerID, &order.SellerID, &order.ListingID,
			&order.Quantity, &order.TotalPrice, &order.Status,
			&order.PaymentMethod, &order.CreatedAt, &order.UpdatedAt,
		)
		if err != nil {
			return nil, databaseCheckoutError(err)
		}
		// The whole lot is taken, so the listing leaves the marketplace -- but it
		// is only reserved, not sold. It becomes 'sold' when the seller confirms
		// delivery, exactly as on the meetup path.
		remainingStock := 0
		listingStatus := "pending"
		if _, err = tx.ExecContext(ctx, `
			UPDATE listings
			SET stock_quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $3`,
			remainingStock, listingStatus, item.request.ListingID,
		); err != nil {
			return nil, databaseCheckoutError(err)
		}
		orders = append(orders, order)
	}

	if err = tx.Commit(); err != nil {
		return nil, databaseCheckoutError(err)
	}
	return &stripeCheckoutReservation{
		Payment: stripePaymentRecord{
			ID:               paymentID,
			BuyerID:          buyerID,
			SellerID:         sellerID,
			AmountMinor:      amountMinor,
			PlatformFeeMinor: platformFeeMinor,
			Currency:         stripeCurrency,
			Status:           "initializing",
			IdempotencyKey:   idempotencyKey,
			SessionExpiresAt: expiresAt,
		},
		Orders: orders,
		Items:  lineItems,
	}, nil
}

func (s *StripePaymentService) loadExistingReservation(
	ctx context.Context,
	checkoutRequestID string,
) (*stripeCheckoutReservation, error) {
	var payment stripePaymentRecord
	var sessionID sql.NullString
	var checkoutURL sql.NullString
	var intentID sql.NullString
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT id, buyer_id, seller_id, amount_minor, platform_fee_minor, status,
			stripe_idempotency_key, stripe_checkout_session_id,
			stripe_checkout_url, stripe_payment_intent_id, session_expires_at,
			stock_released
		FROM payments
		WHERE checkout_request_id = $1`,
		checkoutRequestID,
	).Scan(
		&payment.ID, &payment.BuyerID, &payment.SellerID,
		&payment.AmountMinor, &payment.PlatformFeeMinor, &payment.Status,
		&payment.IdempotencyKey, &sessionID, &checkoutURL, &intentID,
		&expiresAt, &payment.StockReleased,
	)
	if err != nil {
		return nil, err
	}
	if sessionID.Valid {
		payment.CheckoutSessionID = sessionID.String
	}
	if checkoutURL.Valid {
		payment.CheckoutURL = checkoutURL.String
	}
	if intentID.Valid {
		payment.StripePaymentIntent = intentID.String
	}
	if expiresAt.Valid {
		payment.SessionExpiresAt = expiresAt.Time
	}

	orders, lineItems, err := loadPaymentOrders(ctx, s.db, payment.ID, payment.Status)
	if err != nil {
		return nil, err
	}
	return &stripeCheckoutReservation{Payment: payment, Orders: orders, Items: lineItems}, nil
}

type queryContext interface {
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
}

func loadPaymentOrders(
	ctx context.Context,
	queryer queryContext,
	paymentID int64,
	paymentStatus string,
) ([]Order, []StripeCheckoutLineItem, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT
			o.id, o.buyer_id, o.seller_id, o.listing_id, o.quantity,
			o.total_price, o.status, o.payment_method, o.created_at, o.updated_at,
			(ROUND(o.total_price * 100)::BIGINT / o.quantity)
		FROM orders o
		WHERE o.payment_id = $1
		ORDER BY o.id`,
		paymentID,
	)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	orders := []Order{}
	items := []StripeCheckoutLineItem{}
	for rows.Next() {
		var order Order
		var unitAmount int64
		if err := rows.Scan(
			&order.ID, &order.BuyerID, &order.SellerID, &order.ListingID,
			&order.Quantity, &order.TotalPrice, &order.Status,
			&order.PaymentMethod, &order.CreatedAt, &order.UpdatedAt,
			&unitAmount,
		); err != nil {
			return nil, nil, err
		}
		order.PaymentStatus = presentPaymentStatus(paymentStatus)
		orders = append(orders, order)
		items = append(items, StripeCheckoutLineItem{
			ListingID:      order.ListingID,
			Name:           fmt.Sprintf("Marketplace listing #%d", order.ListingID),
			UnitAmount:     unitAmount,
			Quantity:       int64(order.Quantity),
			LineTotalMinor: unitAmount * int64(order.Quantity),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return orders, items, nil
}

func (s *StripePaymentService) resumeCheckout(
	ctx context.Context,
	buyerID int,
	reservation *stripeCheckoutReservation,
) (CreateOrdersResponse, *checkoutHTTPError) {
	if reservation.Payment.BuyerID != buyerID {
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  409,
			Message: "checkoutRequestId is already in use",
		}
	}
	switch reservation.Payment.Status {
	case "initializing":
		return s.createProviderSession(ctx, reservation)
	case "pending", "failed":
		if reservation.Payment.CheckoutURL == "" {
			return s.createProviderSession(ctx, reservation)
		}
		if !reservation.Payment.SessionExpiresAt.IsZero() &&
			!s.now().Before(reservation.Payment.SessionExpiresAt) {
			return CreateOrdersResponse{}, &checkoutHTTPError{
				Status:  409,
				Message: "Stripe Checkout Session has expired",
			}
		}
		return checkoutResponse(reservation), nil
	case "paid":
		return checkoutResponse(reservation), nil
	default:
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  409,
			Message: "Stripe checkout attempt is no longer active",
		}
	}
}

func (s *StripePaymentService) createProviderSession(
	ctx context.Context,
	reservation *stripeCheckoutReservation,
) (CreateOrdersResponse, *checkoutHTTPError) {
	payment := reservation.Payment
	session, err := s.client.CreateCheckoutSession(ctx, StripeCheckoutSessionRequest{
		PaymentID:        payment.ID,
		BuyerID:          payment.BuyerID,
		SellerID:         payment.SellerID,
		AmountMinor:      payment.AmountMinor,
		PlatformFeeMinor: payment.PlatformFeeMinor,
		ConnectedAccount: s.config.ConnectedAccountID,
		SuccessURL:       s.config.SuccessURL,
		CancelURL:        s.config.CancelURL,
		ExpiresAt:        payment.SessionExpiresAt,
		IdempotencyKey:   payment.IdempotencyKey,
		LineItems:        reservation.Items,
	})
	if err != nil {
		if isAmbiguousStripeError(err) {
			log.Printf("Stripe Checkout Session creation is ambiguous for payment %d", payment.ID)
			return CreateOrdersResponse{}, &checkoutHTTPError{
				Status:  503,
				Message: "Stripe checkout is temporarily unavailable; retry this checkout",
				Err:     err,
			}
		}
		if releaseErr := releaseReservedStock(ctx, s.db, payment.ID, "cancelled"); releaseErr != nil {
			return CreateOrdersResponse{}, databaseCheckoutError(releaseErr)
		}
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  502,
			Message: "Stripe rejected the checkout; reserved stock was restored",
			Err:     err,
		}
	}
	if session == nil || session.ID == "" || session.URL == "" || session.LiveMode {
		if session != nil && session.ID != "" {
			_ = s.client.ExpireCheckoutSession(ctx, session.ID)
		}
		if releaseErr := releaseReservedStock(ctx, s.db, payment.ID, "cancelled"); releaseErr != nil {
			return CreateOrdersResponse{}, databaseCheckoutError(releaseErr)
		}
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  502,
			Message: "Stripe returned an invalid sandbox Checkout Session",
		}
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE payments
		SET stripe_checkout_session_id = $1,
			stripe_checkout_url = $2,
			session_expires_at = $3,
			status = 'pending',
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $4 AND status IN ('initializing', 'failed')`,
		session.ID, session.URL, session.ExpiresAt, payment.ID,
	)
	if err != nil {
		if recovered, recoverErr := s.recoverPersistedSession(ctx, reservation, session); recovered {
			return checkoutResponse(reservation), nil
		} else if recoverErr != nil {
			log.Printf("Could not inspect concurrent Stripe Session persistence for payment %d", payment.ID)
		}
		return s.handleSessionPersistenceFailure(ctx, payment.ID, session, err)
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		if recovered, recoverErr := s.recoverPersistedSession(ctx, reservation, session); recovered {
			return checkoutResponse(reservation), nil
		} else if recoverErr != nil {
			log.Printf("Could not inspect concurrent Stripe Session persistence for payment %d", payment.ID)
		}
		if err == nil {
			err = errors.New("payment was not in initializing state")
		}
		return s.handleSessionPersistenceFailure(ctx, payment.ID, session, err)
	}

	reservation.Payment.CheckoutSessionID = session.ID
	reservation.Payment.CheckoutURL = session.URL
	reservation.Payment.SessionExpiresAt = session.ExpiresAt
	reservation.Payment.Status = "pending"
	for index := range reservation.Orders {
		reservation.Orders[index].PaymentStatus = "awaiting_payment"
	}
	return checkoutResponse(reservation), nil
}

func (s *StripePaymentService) recoverPersistedSession(
	ctx context.Context,
	reservation *stripeCheckoutReservation,
	session *StripeCheckoutSession,
) (bool, error) {
	var status string
	var sessionID sql.NullString
	var checkoutURL sql.NullString
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT status, stripe_checkout_session_id, stripe_checkout_url, session_expires_at
		FROM payments
		WHERE id = $1`,
		reservation.Payment.ID,
	).Scan(&status, &sessionID, &checkoutURL, &expiresAt)
	if err != nil {
		return false, err
	}
	if (status != "pending" && status != "paid" && status != "failed") ||
		!sessionID.Valid || sessionID.String != session.ID ||
		!checkoutURL.Valid || checkoutURL.String == "" {
		return false, nil
	}
	reservation.Payment.Status = status
	reservation.Payment.CheckoutSessionID = sessionID.String
	reservation.Payment.CheckoutURL = checkoutURL.String
	if expiresAt.Valid {
		reservation.Payment.SessionExpiresAt = expiresAt.Time
	}
	for index := range reservation.Orders {
		reservation.Orders[index].PaymentStatus = presentPaymentStatus(status)
	}
	return true, nil
}

func (s *StripePaymentService) handleSessionPersistenceFailure(
	ctx context.Context,
	paymentID int64,
	session *StripeCheckoutSession,
	persistErr error,
) (CreateOrdersResponse, *checkoutHTTPError) {
	if expireErr := s.client.ExpireCheckoutSession(ctx, session.ID); expireErr != nil {
		log.Printf("Could not confirm expiration of Stripe Session %s for payment %d", session.ID, paymentID)
		return CreateOrdersResponse{}, &checkoutHTTPError{
			Status:  503,
			Message: "Stripe checkout requires reconciliation; reserved stock remains held",
			Err:     persistErr,
		}
	}
	if releaseErr := releaseReservedStock(ctx, s.db, paymentID, "cancelled"); releaseErr != nil {
		return CreateOrdersResponse{}, databaseCheckoutError(releaseErr)
	}
	return CreateOrdersResponse{}, &checkoutHTTPError{
		Status:  500,
		Message: "Could not persist Stripe checkout; the Session was expired and stock restored",
		Err:     persistErr,
	}
}

func isAmbiguousStripeError(err error) bool {
	var stripeErr *stripe.Error
	if errors.As(err, &stripeErr) {
		return stripeErr.HTTPStatusCode == 0 ||
			stripeErr.HTTPStatusCode == 409 ||
			stripeErr.HTTPStatusCode == 429 ||
			stripeErr.HTTPStatusCode >= 500
	}
	return true
}

func releaseReservedStock(ctx context.Context, db *sql.DB, paymentID int64, targetStatus string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := releaseReservedStockTx(ctx, tx, paymentID, targetStatus); err != nil {
		return err
	}
	return tx.Commit()
}

func releaseReservedStockTx(
	ctx context.Context,
	tx *sql.Tx,
	paymentID int64,
	targetStatus string,
) error {
	var status string
	var stockReleased bool
	err := tx.QueryRowContext(ctx, `
		SELECT status, stock_released
		FROM payments
		WHERE id = $1
		FOR UPDATE`,
		paymentID,
	).Scan(&status, &stockReleased)
	if err != nil {
		return err
	}
	if stockReleased || status == "paid" || status == "refunded" {
		return nil
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT listing_id, quantity
		FROM orders
		WHERE payment_id = $1 AND status = 'pending'
		ORDER BY id
		FOR UPDATE`,
		paymentID,
	)
	if err != nil {
		return err
	}
	type stockRelease struct {
		listingID int
		quantity  int
	}
	releases := []stockRelease{}
	for rows.Next() {
		var release stockRelease
		if err := rows.Scan(&release.listingID, &release.quantity); err != nil {
			rows.Close()
			return err
		}
		releases = append(releases, release)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for _, release := range releases {
		if _, err := tx.ExecContext(ctx, `
			UPDATE listings
			SET stock_quantity = stock_quantity + $1,
				status = CASE WHEN status IN ('pending', 'sold') THEN 'active' ELSE status END,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = $2`,
			release.quantity, release.listingID,
		); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE orders
		SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
		WHERE payment_id = $1 AND status = 'pending'`,
		paymentID,
	); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE payments
		SET status = $1, stock_released = TRUE, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2`,
		targetStatus, paymentID,
	)
	return err
}

func checkoutResponse(reservation *stripeCheckoutReservation) CreateOrdersResponse {
	return CreateOrdersResponse{
		Orders:      reservation.Orders,
		TotalPrice:  float64(reservation.Payment.AmountMinor) / 100,
		CheckoutURL: reservation.Payment.CheckoutURL,
	}
}

func minorUnitsDecimal(amount int64) string {
	return fmt.Sprintf("%d.%02d", amount/100, amount%100)
}

func databaseCheckoutError(err error) *checkoutHTTPError {
	return &checkoutHTTPError{
		Status:  500,
		Message: "Database error during checkout",
		Err:     err,
	}
}

func presentPaymentStatus(status string) string {
	switch status {
	case "initializing", "pending":
		return "awaiting_payment"
	default:
		return status
	}
}
