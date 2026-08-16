package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stripe/stripe-go/v85"
)

type fakeStripeCheckoutClient struct {
	request    StripeCheckoutSessionRequest
	session    *StripeCheckoutSession
	createErr  error
	expireErr  error
	createCall int
	expireCall int
}

const (
	stripeTestSellerID    = 7319
	stripeTestSellerEmail = "demo.seller@example.com"
)

func (f *fakeStripeCheckoutClient) CreateCheckoutSession(
	_ context.Context,
	request StripeCheckoutSessionRequest,
) (*StripeCheckoutSession, error) {
	f.createCall++
	f.request = request
	if f.createErr != nil {
		return nil, f.createErr
	}
	if f.session != nil && f.session.ExpiresAt.IsZero() {
		f.session.ExpiresAt = request.ExpiresAt
	}
	return f.session, nil
}

func (f *fakeStripeCheckoutClient) ExpireCheckoutSession(context.Context, string) error {
	f.expireCall++
	return f.expireErr
}

func validStripeTestConfig() StripeConfig {
	return StripeConfig{
		SecretKey:          "sk_test_example",
		ConnectedAccountID: "acct_example",
		SellerEmail:        stripeTestSellerEmail,
		WebhookSecret:      "whsec_example",
		SuccessURL:         "https://localhost:8443/cart?checkout=stripe-return",
		CancelURL:          "https://localhost:8443/cart?checkout=stripe-cancelled",
	}
}

func stripeServiceTestDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	gormDB, mock := newTestGormDB(t)
	db, err := gormDB.DB()
	if err != nil {
		t.Fatalf("gorm DB(): %v", err)
	}
	return db, mock
}

// Listings sell as a whole lot, so the reserved quantity is always the entire
// stock and the listing always lands on 0 / 'pending'.
func expectNewStripeReservation(
	mock sqlmock.Sqlmock,
	now time.Time,
	quantity int,
	sellerID int,
	sellerEmail string,
) {
	stock := quantity
	mock.ExpectQuery("FROM payments").
		WithArgs("8f41ea04-716f-4ca2-9cf2-33fd2da0d72f").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT l.seller_id, u.email, ROUND\\(l.price \\* 100\\)::BIGINT").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{
			"seller_id", "seller_email", "unit_amount_minor", "status", "stock_quantity",
		}).AddRow(sellerID, sellerEmail, 5000, "active", stock))
	mock.ExpectQuery("INSERT INTO payments").
		WithArgs(
			"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
			"marketplace-checkout-8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
			42, sellerID, int64(5000*quantity), int64((5000*quantity+5)/10),
			now.Add(stripeSessionLifetime),
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(900))
	mock.ExpectQuery("INSERT INTO orders").
		WithArgs(42, sellerID, 10, quantity, minorUnitsDecimal(int64(5000*quantity)), int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity",
			"total_price", "status", "payment_method", "created_at", "updated_at",
		}).AddRow(
			1001, 42, sellerID, 10, quantity, float64(50*quantity),
			"pending", "stripe", now, now,
		))
	mock.ExpectExec("UPDATE listings").
		WithArgs(0, "pending", 10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

func TestStripeCheckoutUsesDatabaseMinorUnitsAndDestinationFee(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	now := time.Date(2026, 7, 31, 1, 0, 0, 0, time.UTC)
	expectNewStripeReservation(
		mock,
		now,
		2,
		stripeTestSellerID,
		stripeTestSellerEmail,
	)
	mock.ExpectExec("UPDATE payments").
		WithArgs("cs_test_123", "https://checkout.stripe.com/test", now.Add(stripeSessionLifetime), int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := &fakeStripeCheckoutClient{session: &StripeCheckoutSession{
		ID:  "cs_test_123",
		URL: "https://checkout.stripe.com/test",
	}}
	service := newStripePaymentService(db, validStripeTestConfig(), client)
	service.now = func() time.Time { return now }

	response, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 2}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr != nil {
		t.Fatalf("CreateCheckout() error = %v", checkoutErr)
	}
	if response.CheckoutURL != "https://checkout.stripe.com/test" || response.TotalPrice != 100 {
		t.Fatalf("unexpected response: %#v", response)
	}
	if client.request.AmountMinor != 10000 || client.request.PlatformFeeMinor != 1000 {
		t.Fatalf("amount/fee = %d/%d, want 10000/1000",
			client.request.AmountMinor, client.request.PlatformFeeMinor)
	}
	if client.request.ConnectedAccount != "acct_example" {
		t.Fatalf("destination = %q", client.request.ConnectedAccount)
	}
	if client.request.SellerID != stripeTestSellerID {
		t.Fatalf("seller ID = %d, want arbitrary database ID %d",
			client.request.SellerID, stripeTestSellerID)
	}
	if len(client.request.LineItems) != 1 ||
		client.request.LineItems[0].UnitAmount != 5000 ||
		client.request.LineItems[0].Quantity != 2 {
		t.Fatalf("unexpected line items: %#v", client.request.LineItems)
	}
	if client.request.IdempotencyKey !=
		"marketplace-checkout-8f41ea04-716f-4ca2-9cf2-33fd2da0d72f" {
		t.Fatalf("unexpected idempotency key: %q", client.request.IdempotencyKey)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCheckoutRejectsMultipleSellers(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	client := &fakeStripeCheckoutClient{}
	service := newStripePaymentService(db, validStripeTestConfig(), client)

	mock.ExpectQuery("FROM payments").WillReturnError(sql.ErrNoRows)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT l.seller_id, u.email, ROUND").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{
			"seller_id", "seller_email", "unit_amount_minor", "status", "stock_quantity",
		}).AddRow(stripeTestSellerID, stripeTestSellerEmail, 5000, "active", 1))
	mock.ExpectQuery("SELECT l.seller_id, u.email, ROUND").
		WithArgs(11).
		WillReturnRows(sqlmock.NewRows([]string{
			"seller_id", "seller_email", "unit_amount_minor", "status", "stock_quantity",
		}).AddRow(9221, "another.seller@example.com", 3000, "active", 1))
	mock.ExpectRollback()

	_, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{
			{ListingID: 11, Quantity: 1},
			{ListingID: 10, Quantity: 1},
		},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr == nil || checkoutErr.Status != http.StatusConflict {
		t.Fatalf("error = %#v, want conflict", checkoutErr)
	}
	if client.createCall != 0 {
		t.Fatal("Stripe client called for invalid multi-seller cart")
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCheckoutRejectsSellerEmailMismatch(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	service := newStripePaymentService(db, validStripeTestConfig(), &fakeStripeCheckoutClient{})

	mock.ExpectQuery("FROM payments").WillReturnError(sql.ErrNoRows)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT l.seller_id, u.email, ROUND").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{
			"seller_id", "seller_email", "unit_amount_minor", "status", "stock_quantity",
		}).AddRow(stripeTestSellerID, "different.seller@example.com", 5000, "active", 1))
	mock.ExpectRollback()

	_, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 1}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr == nil || checkoutErr.Status != http.StatusForbidden {
		t.Fatalf("error = %#v, want forbidden", checkoutErr)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCheckoutSellerEmailMatchIsCaseInsensitive(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	now := time.Date(2026, 7, 31, 1, 0, 0, 0, time.UTC)
	expectNewStripeReservation(
		mock,
		now,
		1,
		8842,
		"  DEMO.SELLER@EXAMPLE.COM  ",
	)
	mock.ExpectExec("UPDATE payments").
		WithArgs("cs_test_case", "https://checkout.stripe.com/case", now.Add(stripeSessionLifetime), int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := &fakeStripeCheckoutClient{session: &StripeCheckoutSession{
		ID:  "cs_test_case",
		URL: "https://checkout.stripe.com/case",
	}}
	service := newStripePaymentService(db, validStripeTestConfig(), client)
	service.now = func() time.Time { return now }

	response, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 1}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr != nil || response.CheckoutURL == "" {
		t.Fatalf("response/error = %#v/%v", response, checkoutErr)
	}
	if client.request.SellerID != 8842 {
		t.Fatalf("seller ID = %d, want 8842", client.request.SellerID)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeAmbiguousFailureKeepsStockReserved(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	now := time.Date(2026, 7, 31, 1, 0, 0, 0, time.UTC)
	expectNewStripeReservation(
		mock,
		now,
		1,
		stripeTestSellerID,
		stripeTestSellerEmail,
	)
	client := &fakeStripeCheckoutClient{createErr: errors.New("connection reset")}
	service := newStripePaymentService(db, validStripeTestConfig(), client)
	service.now = func() time.Time { return now }

	_, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 1}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr == nil || checkoutErr.Status != http.StatusServiceUnavailable {
		t.Fatalf("error = %#v, want service unavailable", checkoutErr)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeDefinitiveFailureRestoresStockOnce(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	now := time.Date(2026, 7, 31, 1, 0, 0, 0, time.UTC)
	expectNewStripeReservation(
		mock,
		now,
		1,
		stripeTestSellerID,
		stripeTestSellerEmail,
	)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT status, stock_released").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{"status", "stock_released"}).
			AddRow("initializing", false))
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
		WithArgs("cancelled", int64(900)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	client := &fakeStripeCheckoutClient{createErr: &stripe.Error{
		HTTPStatusCode: http.StatusBadRequest,
		Type:           stripe.ErrorTypeInvalidRequest,
	}}
	service := newStripePaymentService(db, validStripeTestConfig(), client)
	service.now = func() time.Time { return now }

	_, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 1}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr == nil || checkoutErr.Status != http.StatusBadGateway {
		t.Fatalf("error = %#v, want bad gateway", checkoutErr)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCheckoutRetryReturnsExistingSession(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	now := time.Date(2026, 7, 31, 1, 0, 0, 0, time.UTC)
	expiresAt := now.Add(stripeSessionLifetime)
	mock.ExpectQuery("FROM payments").
		WithArgs("8f41ea04-716f-4ca2-9cf2-33fd2da0d72f").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "amount_minor", "platform_fee_minor",
			"status", "stripe_idempotency_key", "stripe_checkout_session_id",
			"stripe_checkout_url", "stripe_payment_intent_id",
			"session_expires_at", "stock_released",
		}).AddRow(
			900, 42, 7, 5000, 500, "pending",
			"marketplace-checkout-8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
			"cs_test_123", "https://checkout.stripe.com/test", nil,
			expiresAt, false,
		))
	mock.ExpectQuery("FROM orders o").
		WithArgs(int64(900)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity",
			"total_price", "status", "payment_method", "created_at", "updated_at",
			"unit_amount_minor",
		}).AddRow(1001, 42, 7, 10, 1, 50.0, "pending", "stripe", now, now, 5000))

	client := &fakeStripeCheckoutClient{}
	service := newStripePaymentService(db, validStripeTestConfig(), client)
	service.now = func() time.Time { return now }
	response, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 1}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr != nil || response.CheckoutURL == "" {
		t.Fatalf("response/error = %#v/%v", response, checkoutErr)
	}
	if client.createCall != 0 {
		t.Fatal("provider called again for persisted Checkout Session")
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeCheckoutRequiresCompleteSandboxConfiguration(t *testing.T) {
	db, mock := stripeServiceTestDB(t)
	config := validStripeTestConfig()
	config.SellerEmail = ""
	service := newStripePaymentService(db, config, &fakeStripeCheckoutClient{})

	_, checkoutErr := service.CreateCheckout(
		context.Background(),
		42,
		[]CreateOrderItemRequest{{ListingID: 10, Quantity: 1}},
		"8f41ea04-716f-4ca2-9cf2-33fd2da0d72f",
	)
	if checkoutErr == nil || checkoutErr.Status != http.StatusServiceUnavailable {
		t.Fatalf("error = %#v, want service unavailable", checkoutErr)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestStripeSellerEmailValidation(t *testing.T) {
	valid := []string{
		"demo.seller@example.com",
		"DEMO.SELLER@EXAMPLE.COM",
		"  demo.seller+stripe@example.co.uk  ",
	}
	for _, value := range valid {
		if !validStripeSellerEmail(value) {
			t.Errorf("validStripeSellerEmail(%q) = false, want true", value)
		}
	}

	invalid := []string{
		"",
		"demo.seller",
		"@example.com",
		"demo.seller@example",
		"Demo Seller <demo.seller@example.com>",
		"demo seller@example.com",
	}
	for _, value := range invalid {
		if validStripeSellerEmail(value) {
			t.Errorf("validStripeSellerEmail(%q) = true, want false", value)
		}
	}
}

func TestPlatformFeeUsesHalfUpMinorUnitRounding(t *testing.T) {
	tests := []struct {
		amount int64
		fee    int64
	}{
		{amount: 10000, fee: 1000},
		{amount: 10005, fee: 1001},
		{amount: 5, fee: 1},
		{amount: 4, fee: 0},
	}
	for _, test := range tests {
		if got := (test.amount + 5) / 10; got != test.fee {
			t.Errorf("fee(%d) = %d, want %d", test.amount, got, test.fee)
		}
	}
}
