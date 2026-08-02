package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	"github.com/stripe/stripe-go/v85"
	"transcendence/modules/user/notifications"
)

const testWebhookSecret = "whsec_test_webhook_secret"

func signedStripeEvent(t *testing.T, eventType string, object map[string]interface{}) ([]byte, string) {
	t.Helper()
	payload, err := json.Marshal(map[string]interface{}{
		"id":          "evt_test_123",
		"object":      "event",
		"api_version": stripe.APIVersion,
		"created":     time.Now().Unix(),
		"livemode":    false,
		"type":        eventType,
		"data": map[string]interface{}{
			"object": object,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	timestamp := time.Now().Unix()
	signedPayload := fmt.Sprintf("%d.%s", timestamp, payload)
	mac := hmac.New(sha256.New, []byte(testWebhookSecret))
	_, _ = mac.Write([]byte(signedPayload))
	signature := fmt.Sprintf("t=%d,v1=%s", timestamp, hex.EncodeToString(mac.Sum(nil)))
	return payload, signature
}

func checkoutSessionEventObject(paymentStatus string) map[string]interface{} {
	return map[string]interface{}{
		"id":             "cs_test_123",
		"object":         "checkout.session",
		"livemode":       false,
		"currency":       "myr",
		"amount_total":   5000,
		"payment_status": paymentStatus,
		"payment_intent": "pi_test_123",
		"metadata": map[string]string{
			"payment_id": "900",
			"buyer_id":   "42",
			"seller_id":  "7",
		},
	}
}

func callStripeWebhook(
	t *testing.T,
	service *StripeWebhookService,
	payload []byte,
	signature string,
) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/stripe", bytes.NewReader(payload))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	request.Header.Set("Stripe-Signature", signature)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	if err := handleStripeWebhook(context, service); err != nil {
		t.Fatalf("handleStripeWebhook() error = %v", err)
	}
	return recorder
}

func TestStripeWebhookRejectsInvalidSignature(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	recorder := callStripeWebhook(t, service, []byte(`{"id":"evt_bad"}`), "invalid")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeWebhookRejectsOversizedBody(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	payload := bytes.Repeat([]byte("x"), int(stripeWebhookBodyLimit)+1)
	recorder := callStripeWebhook(t, service, payload, "invalid")
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", recorder.Code)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCompletedWebhookMarksPaid(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	payload, signature := signedStripeEvent(
		t,
		string(stripe.EventTypeCheckoutSessionCompleted),
		checkoutSessionEventObject("paid"),
	)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO stripe_webhook_events").
		WithArgs("evt_test_123", string(stripe.EventTypeCheckoutSessionCompleted), "cs_test_123").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM payments").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
			"currency", "status", "stripe_checkout_session_id",
			"stripe_payment_intent_id", "stock_released",
		}).AddRow(900, 42, 7, 5000, 500, "myr", "pending", "cs_test_123", nil, false))
	mock.ExpectExec("UPDATE payments").
		WithArgs("cs_test_123", "pi_test_123", int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	recorder := callStripeWebhook(t, service, payload, signature)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCompletedWebhookCreatesSellerNotificationAfterPayment(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	payload, signature := signedStripeEvent(
		t,
		string(stripe.EventTypeCheckoutSessionCompleted),
		checkoutSessionEventObject("paid"),
	)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO stripe_webhook_events").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM payments").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
			"currency", "status", "stripe_checkout_session_id",
			"stripe_payment_intent_id", "stock_released",
		}).AddRow(900, 42, 7, 5000, 500, "myr", "pending", "cs_test_123", nil, false))
	mock.ExpectExec("UPDATE payments").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT o.id, o.listing_id, o.quantity, l.title").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "listing_id", "quantity", "title",
		}).AddRow(1001, 10, 1, "Astrox 99"))
	mock.ExpectQuery("INSERT INTO notifications").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(501))
	mock.ExpectCommit()

	notificationService := notifications.NewService(notifications.NewRepository(db))
	service := newStripeWebhookService(
		db,
		StripeConfig{WebhookSecret: testWebhookSecret},
		notificationService,
	)
	recorder := callStripeWebhook(t, service, payload, signature)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCompletedWebhookDoesNotAcceptUnpaidSession(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	payload, signature := signedStripeEvent(
		t,
		string(stripe.EventTypeCheckoutSessionCompleted),
		checkoutSessionEventObject("unpaid"),
	)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO stripe_webhook_events").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM payments").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
			"currency", "status", "stripe_checkout_session_id",
			"stripe_payment_intent_id", "stock_released",
		}).AddRow(900, 42, 7, 5000, 500, "myr", "pending", "cs_test_123", nil, false))
	mock.ExpectCommit()

	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	recorder := callStripeWebhook(t, service, payload, signature)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCompletedWebhookRejectsPaymentMismatches(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]interface{})
	}{
		{
			name: "amount",
			mutate: func(object map[string]interface{}) {
				object["amount_total"] = 4999
			},
		},
		{
			name: "currency",
			mutate: func(object map[string]interface{}) {
				object["currency"] = "usd"
			},
		},
		{
			name: "session ID",
			mutate: func(object map[string]interface{}) {
				object["id"] = "cs_test_wrong"
			},
		},
		{
			name: "metadata",
			mutate: func(object map[string]interface{}) {
				object["metadata"] = map[string]string{
					"payment_id": "900",
					"buyer_id":   "99",
					"seller_id":  "7",
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, mock := stripeServiceTestDB(t)
			object := checkoutSessionEventObject("paid")
			test.mutate(object)
			payload, signature := signedStripeEvent(
				t,
				string(stripe.EventTypeCheckoutSessionCompleted),
				object,
			)
			mock.ExpectBegin()
			mock.ExpectExec("INSERT INTO stripe_webhook_events").
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery("FROM payments").
				WithArgs(int64(900)).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
					"currency", "status", "stripe_checkout_session_id",
					"stripe_payment_intent_id", "stock_released",
				}).AddRow(900, 42, 7, 5000, 500, "myr", "pending", "cs_test_123", nil, false))
			mock.ExpectRollback()

			service := newStripeWebhookService(
				db,
				StripeConfig{WebhookSecret: testWebhookSecret},
				nil,
			)
			recorder := callStripeWebhook(t, service, payload, signature)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", recorder.Code, recorder.Body.String())
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

func TestStripeWebhookDuplicateEventHasNoSideEffects(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	payload, signature := signedStripeEvent(
		t,
		string(stripe.EventTypeCheckoutSessionCompleted),
		checkoutSessionEventObject("paid"),
	)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO stripe_webhook_events").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	recorder := callStripeWebhook(t, service, payload, signature)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeExpiredWebhookRestoresStock(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	object := checkoutSessionEventObject("unpaid")
	payload, signature := signedStripeEvent(
		t,
		string(stripe.EventTypeCheckoutSessionExpired),
		object,
	)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO stripe_webhook_events").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM payments").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
			"currency", "status", "stripe_checkout_session_id",
			"stripe_payment_intent_id", "stock_released",
		}).AddRow(900, 42, 7, 5000, 500, "myr", "pending", "cs_test_123", nil, false))
	mock.ExpectQuery("SELECT status, stock_released").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{"status", "stock_released"}).AddRow("pending", false))
	mock.ExpectQuery("SELECT listing_id, quantity").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{"listing_id", "quantity"}).AddRow(10, 1))
	mock.ExpectExec("UPDATE listings").
		WithArgs(1, 10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE orders").
		WithArgs(int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE payments").
		WithArgs("expired", int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	recorder := callStripeWebhook(t, service, payload, signature)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripePaymentFailedWebhookRetainsStock(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	payload, signature := signedStripeEvent(
		t,
		string(stripe.EventTypePaymentIntentPaymentFailed),
		map[string]interface{}{
			"id":       "pi_test_123",
			"object":   "payment_intent",
			"livemode": false,
			"currency": "myr",
			"amount":   5000,
			"metadata": map[string]string{
				"payment_id": "900",
				"buyer_id":   "42",
				"seller_id":  "7",
			},
		},
	)
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO stripe_webhook_events").
		WithArgs("evt_test_123", string(stripe.EventTypePaymentIntentPaymentFailed), "pi_test_123").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM payments").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
			"currency", "status", "stripe_checkout_session_id",
			"stripe_payment_intent_id", "stock_released",
		}).AddRow(900, 42, 7, 5000, 500, "myr", "pending", "cs_test_123", nil, false))
	mock.ExpectExec("UPDATE payments").
		WithArgs("pi_test_123", int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	service := newStripeWebhookService(db, StripeConfig{WebhookSecret: testWebhookSecret}, nil)
	recorder := callStripeWebhook(t, service, payload, signature)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}
