package order

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/stripe/stripe-go/v85"
	"transcendence/modules/user/notifications"
)

const stripeWebhookBodyLimit int64 = 1 << 20

type StripeWebhookService struct {
	db                  *sql.DB
	webhookSecret       string
	notificationService *notifications.Service
}

func NewStripeWebhookService(
	db *sql.DB,
	config StripeConfig,
	notificationService *notifications.Service,
) *StripeWebhookService {
	return &StripeWebhookService{
		db:                  db,
		webhookSecret:       config.WebhookSecret,
		notificationService: notificationService,
	}
}

func HandleStripeWebhook(c echo.Context, service *StripeWebhookService) error {
	if service == nil || service.db == nil ||
		!strings.HasPrefix(service.webhookSecret, "whsec_") {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{
			"error": "Stripe webhook is not configured",
		})
	}

	request := c.Request()
	request.Body = http.MaxBytesReader(c.Response().Writer, request.Body, stripeWebhookBodyLimit)
	payload, err := io.ReadAll(request.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{
				"error": "Webhook body is too large",
			})
		}
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid webhook body"})
	}

	signature := request.Header.Get("Stripe-Signature")
	if signature == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Stripe signature"})
	}
	event, err := stripe.ConstructEvent(payload, signature, service.webhookSecret)
	if err != nil || event.Livemode {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Stripe signature"})
	}

	var processErr error
	switch event.Type {
	case stripe.EventTypeCheckoutSessionCompleted:
		var session stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Stripe event"})
		}
		processErr = service.processCompleted(request.Context(), event, &session)
	case stripe.EventTypeCheckoutSessionExpired:
		var session stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Stripe event"})
		}
		processErr = service.processExpired(request.Context(), event, &session)
	case stripe.EventTypePaymentIntentPaymentFailed:
		var paymentIntent stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &paymentIntent); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Stripe event"})
		}
		processErr = service.processPaymentFailed(request.Context(), event, &paymentIntent)
	default:
		return c.JSON(http.StatusOK, map[string]bool{"received": true})
	}
	if processErr != nil {
		var invalid *invalidStripeEventError
		if errors.As(processErr, &invalid) {
			log.Printf("Rejected inconsistent Stripe event %s", event.ID)
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Stripe event"})
		}
		log.Printf("Stripe webhook database processing failed for event %s", event.ID)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Stripe event processing failed",
		})
	}
	return c.JSON(http.StatusOK, map[string]bool{"received": true})
}

type invalidStripeEventError struct {
	message string
}

func (e *invalidStripeEventError) Error() string {
	return e.message
}

func invalidStripeEvent(message string) error {
	return &invalidStripeEventError{message: message}
}

func (s *StripeWebhookService) processCompleted(
	ctx context.Context,
	event stripe.Event,
	session *stripe.CheckoutSession,
) error {
	paymentID, err := paymentIDFromMetadata(session.Metadata)
	if err != nil {
		return err
	}
	tx, duplicate, err := s.beginEvent(ctx, event, session.ID)
	if err != nil || duplicate {
		return err
	}
	defer tx.Rollback()

	payment, err := lockWebhookPayment(ctx, tx, paymentID)
	if err != nil {
		return err
	}
	if err := validateSessionForPayment(session, payment); err != nil {
		return err
	}
	if session.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
		return tx.Commit()
	}
	if payment.Status == "paid" {
		return tx.Commit()
	}
	if payment.Status != "initializing" &&
		payment.Status != "pending" &&
		payment.Status != "failed" {
		return invalidStripeEvent("paid event conflicts with terminal payment state")
	}

	paymentIntentID := ""
	if session.PaymentIntent != nil {
		paymentIntentID = session.PaymentIntent.ID
	}
	if paymentIntentID == "" {
		return invalidStripeEvent("paid Session has no PaymentIntent")
	}
	if payment.StripePaymentIntent != "" &&
		payment.StripePaymentIntent != paymentIntentID {
		return invalidStripeEvent("PaymentIntent does not match payment")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE payments
		SET status = 'paid',
			stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, $1),
			stripe_payment_intent_id = $2,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $3`,
		session.ID, paymentIntentID, payment.ID,
	); err != nil {
		return err
	}

	pending := []pendingNotification{}
	if s.notificationService != nil && s.notificationService.Repo != nil {
		rows, err := tx.QueryContext(ctx, `
			SELECT o.id, o.listing_id, o.quantity, l.title
			FROM orders o
			JOIN listings l ON l.id = o.listing_id
			WHERE o.payment_id = $1 AND o.status = 'pending'
			ORDER BY o.id`,
			payment.ID,
		)
		if err != nil {
			return err
		}
		type paidOrder struct {
			id        int
			listingID int
			quantity  int
			title     string
		}
		orders := []paidOrder{}
		for rows.Next() {
			var order paidOrder
			if err := rows.Scan(&order.id, &order.listingID, &order.quantity, &order.title); err != nil {
				rows.Close()
				return err
			}
			orders = append(orders, order)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, order := range orders {
			actorID := payment.BuyerID
			resourceID := order.id
			notificationID, err := s.notificationService.Repo.CreateTx(
				tx,
				payment.SellerID,
				&actorID,
				notifications.TypeOrderNew,
				&resourceID,
				map[string]interface{}{
					"orderId":      order.id,
					"listingId":    order.listingID,
					"listingTitle": order.title,
					"quantity":     order.quantity,
				},
			)
			if err != nil {
				return err
			}
			pending = append(pending, pendingNotification{
				userID:         payment.SellerID,
				notificationID: notificationID,
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	for _, item := range pending {
		s.notificationService.PublishByID(item.userID, item.notificationID)
	}
	return nil
}

func (s *StripeWebhookService) processExpired(
	ctx context.Context,
	event stripe.Event,
	session *stripe.CheckoutSession,
) error {
	paymentID, err := paymentIDFromMetadata(session.Metadata)
	if err != nil {
		return err
	}
	tx, duplicate, err := s.beginEvent(ctx, event, session.ID)
	if err != nil || duplicate {
		return err
	}
	defer tx.Rollback()

	payment, err := lockWebhookPayment(ctx, tx, paymentID)
	if err != nil {
		return err
	}
	if err := validateSessionForPayment(session, payment); err != nil {
		return err
	}
	if err := releaseReservedStockTx(ctx, tx, payment.ID, "expired"); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *StripeWebhookService) processPaymentFailed(
	ctx context.Context,
	event stripe.Event,
	intent *stripe.PaymentIntent,
) error {
	paymentID, err := paymentIDFromMetadata(intent.Metadata)
	if err != nil {
		return err
	}
	tx, duplicate, err := s.beginEvent(ctx, event, intent.ID)
	if err != nil || duplicate {
		return err
	}
	defer tx.Rollback()

	payment, err := lockWebhookPayment(ctx, tx, paymentID)
	if err != nil {
		return err
	}
	if intent.Livemode ||
		intent.Amount != payment.AmountMinor ||
		string(intent.Currency) != payment.Currency {
		return invalidStripeEvent("PaymentIntent amount or currency does not match")
	}
	if err := validatePaymentMetadata(intent.Metadata, payment); err != nil {
		return err
	}
	if payment.StripePaymentIntent != "" &&
		payment.StripePaymentIntent != intent.ID {
		return invalidStripeEvent("PaymentIntent does not match payment")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE payments
		SET status = CASE
				WHEN status IN ('initializing', 'pending') THEN 'failed'
				ELSE status
			END,
			stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $1),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $2`,
		intent.ID, payment.ID,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *StripeWebhookService) beginEvent(
	ctx context.Context,
	event stripe.Event,
	objectID string,
) (*sql.Tx, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO stripe_webhook_events (
			stripe_event_id, event_type, stripe_object_id
		)
		VALUES ($1, $2, $3)
		ON CONFLICT (stripe_event_id) DO NOTHING`,
		event.ID, string(event.Type), objectID,
	)
	if err != nil {
		tx.Rollback()
		return nil, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		tx.Rollback()
		return nil, false, err
	}
	if affected == 0 {
		if err := tx.Commit(); err != nil {
			return nil, false, err
		}
		return nil, true, nil
	}
	return tx, false, nil
}

func lockWebhookPayment(
	ctx context.Context,
	tx *sql.Tx,
	paymentID int64,
) (stripePaymentRecord, error) {
	var payment stripePaymentRecord
	var sessionID sql.NullString
	var intentID sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT id, buyer_id, seller_id, amount_minor, platform_fee_minor,
			currency, status, stripe_checkout_session_id,
			stripe_payment_intent_id, stock_released
		FROM payments
		WHERE id = $1 AND provider = 'stripe'
		FOR UPDATE`,
		paymentID,
	).Scan(
		&payment.ID, &payment.BuyerID, &payment.SellerID,
		&payment.AmountMinor, &payment.PlatformFeeMinor, &payment.Currency,
		&payment.Status, &sessionID, &intentID, &payment.StockReleased,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return stripePaymentRecord{}, invalidStripeEvent("payment does not exist")
	}
	if err != nil {
		return stripePaymentRecord{}, err
	}
	if sessionID.Valid {
		payment.CheckoutSessionID = sessionID.String
	}
	if intentID.Valid {
		payment.StripePaymentIntent = intentID.String
	}
	return payment, nil
}

func validateSessionForPayment(
	session *stripe.CheckoutSession,
	payment stripePaymentRecord,
) error {
	if session == nil || session.ID == "" || session.Livemode {
		return invalidStripeEvent("invalid test-mode Checkout Session")
	}
	if payment.CheckoutSessionID != "" &&
		payment.CheckoutSessionID != session.ID {
		return invalidStripeEvent("Checkout Session does not match payment")
	}
	if session.AmountTotal != payment.AmountMinor ||
		string(session.Currency) != payment.Currency {
		return invalidStripeEvent("Checkout Session amount or currency does not match")
	}
	return validatePaymentMetadata(session.Metadata, payment)
}

func validatePaymentMetadata(metadata map[string]string, payment stripePaymentRecord) error {
	if metadata["payment_id"] != strconv.FormatInt(payment.ID, 10) ||
		metadata["buyer_id"] != strconv.Itoa(payment.BuyerID) ||
		metadata["seller_id"] != strconv.Itoa(payment.SellerID) {
		return invalidStripeEvent("Stripe metadata does not match payment")
	}
	return nil
}

func paymentIDFromMetadata(metadata map[string]string) (int64, error) {
	paymentID, err := strconv.ParseInt(metadata["payment_id"], 10, 64)
	if err != nil || paymentID <= 0 {
		return 0, invalidStripeEvent("Stripe event has no valid payment ID")
	}
	return paymentID, nil
}
