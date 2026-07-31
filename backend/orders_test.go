package main

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	"transcendence/modules/user/notifications"
)

func TestIsValidOrderStatusUsesStrictAllowlist(t *testing.T) {
	valid := []string{"pending", "completed", "cancelled", "refunded"}
	for _, status := range valid {
		if !isValidOrderStatus(status) {
			t.Errorf("expected %q to be accepted", status)
		}
	}

	invalid := []string{
		"",
		"shipped",
		"COMPLETED",
		"completed ",
		"completed; DROP TABLE orders;",
	}
	for _, status := range invalid {
		if isValidOrderStatus(status) {
			t.Errorf("expected %q to be rejected", status)
		}
	}
}

func TestCreateOrdersRejectsUnsafeRequestsBeforeStartingTransaction(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		authUserID any
		wantStatus int
	}{
		{
			name:       "unauthenticated",
			body:       `{"items":[{"listingId":1,"quantity":1}]}`,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "empty checkout",
			body:       `{"items":[]}`,
			authUserID: 42,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid listing id",
			body:       `{"items":[{"listingId":0,"quantity":1}]}`,
			authUserID: 42,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid quantity",
			body:       `{"items":[{"listingId":1,"quantity":0}]}`,
			authUserID: 42,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "duplicate listing",
			body:       `{"items":[{"listingId":1,"quantity":1},{"listingId":1,"quantity":1}]}`,
			authUserID: 42,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "unsupported payment method",
			body:       `{"items":[{"listingId":1,"quantity":1}],"paymentMethod":"card"}`,
			authUserID: 42,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			e := echo.New()
			request := httptest.NewRequest(http.MethodPost, "/orders", bytes.NewBufferString(test.body))
			request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			if test.authUserID != nil {
				context.Set("userId", test.authUserID)
			}

			if err := createOrders(context, gormDB); err != nil {
				t.Fatalf("createOrders() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

// Checkout reserves the listing rather than selling it: 'sold' is reached only
// when the seller confirms delivery.
func TestCreateOrdersLocksStockCommitsAndMarksPending(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT seller_id, price, status, stock_quantity").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"seller_id", "price", "status", "stock_quantity"}).
			AddRow(7, 50.0, "active", 2))
	mock.ExpectQuery("INSERT INTO orders").
		WithArgs(42, 7, 10, 2, 100.0, "meetup").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity",
			"total_price", "status", "payment_method", "created_at", "updated_at",
		}).AddRow(1001, 42, 7, 10, 2, 100.0, "pending", "meetup", now, now))
	mock.ExpectExec("UPDATE listings").
		WithArgs(0, "pending", 10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/orders",
		bytes.NewBufferString(`{"items":[{"listingId":10,"quantity":2}]}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", 42)

	if err := createOrders(context, gormDB); err != nil {
		t.Fatalf("createOrders() error = %v", err)
	}
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte(`"totalPrice":100`)) {
		t.Fatalf("response does not contain trusted checkout total: %s", recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateOrdersPersistsSellerNotificationBeforeCommit(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	sqlDB, err := gormDB.DB()
	if err != nil {
		t.Fatalf("gorm DB() error = %v", err)
	}
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT seller_id, price, status, stock_quantity").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"seller_id", "price", "status", "stock_quantity"}).
			AddRow(7, 50.0, "active", 2))
	mock.ExpectQuery("INSERT INTO orders").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity",
			"total_price", "status", "payment_method", "created_at", "updated_at",
		}).AddRow(1001, 42, 7, 10, 2, 100.0, "pending", "meetup", now, now))
	// Buying the lot always empties it, so the listing goes straight to sold.
	mock.ExpectExec("UPDATE listings").
		WithArgs(0, "pending", 10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT title FROM listings").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"title"}).AddRow("Astrox 99"))
	mock.ExpectQuery("INSERT INTO notifications").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(501))
	mock.ExpectCommit()

	service := notifications.NewService(notifications.NewRepository(sqlDB))
	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/orders",
		bytes.NewBufferString(`{"items":[{"listingId":10,"quantity":2}]}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", 42)

	if err := createOrdersWithNotifications(context, gormDB, service); err != nil {
		t.Fatalf("createOrdersWithNotifications() error = %v", err)
	}
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCompleteOrderPersistsBuyerNotificationBeforeCommit(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	sqlDB, err := gormDB.DB()
	if err != nil {
		t.Fatalf("gorm DB() error = %v", err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE orders").
		WithArgs(55, 7).
		WillReturnRows(sqlmock.NewRows([]string{"buyer_id", "listing_id"}).AddRow(42, 10))
	// Delivery is what turns the reserved listing into a sold one.
	mock.ExpectExec("UPDATE listings").
		WithArgs(10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT title FROM listings").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"title"}).AddRow("Astrox 99"))
	mock.ExpectQuery("INSERT INTO notifications").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(502))
	mock.ExpectCommit()

	service := notifications.NewService(notifications.NewRepository(sqlDB))
	e := echo.New()
	request := httptest.NewRequest(http.MethodPut, "/orders/55/complete", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/orders/:id/complete")
	context.SetParamNames("id")
	context.SetParamValues("55")
	context.Set("userId", 7)

	if err := completeOrderWithNotifications(context, gormDB, service); err != nil {
		t.Fatalf("completeOrderWithNotifications() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateOrdersRejectsOwnListingAndInsufficientStock(t *testing.T) {
	tests := []struct {
		name       string
		sellerID   int
		stock      int
		quantity   int
		wantStatus int
	}{
		{name: "own listing", sellerID: 42, stock: 5, quantity: 1, wantStatus: http.StatusForbidden},
		{name: "insufficient stock", sellerID: 7, stock: 1, quantity: 2, wantStatus: http.StatusConflict},
		// Listings sell as a whole lot: taking only part of one is refused, so
		// a listing can never sit half-sold and invisible to the Sold tab.
		{name: "partial lot", sellerID: 7, stock: 5, quantity: 2, wantStatus: http.StatusConflict},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT seller_id, price, status, stock_quantity").
				WithArgs(10).
				WillReturnRows(sqlmock.NewRows([]string{"seller_id", "price", "status", "stock_quantity"}).
					AddRow(test.sellerID, 50.0, "active", test.stock))
			mock.ExpectRollback()

			body := fmt.Sprintf(`{"items":[{"listingId":10,"quantity":%d}]}`, test.quantity)

			e := echo.New()
			request := httptest.NewRequest(http.MethodPost, "/orders", bytes.NewBufferString(body))
			request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.Set("userId", 42)

			if err := createOrders(context, gormDB); err != nil {
				t.Fatalf("createOrders() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

func TestCreateOrdersRollsBackWhenStockUpdateFails(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT seller_id, price, status, stock_quantity").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"seller_id", "price", "status", "stock_quantity"}).
			AddRow(7, 50.0, "active", 3))
	mock.ExpectQuery("INSERT INTO orders").
		WithArgs(42, 7, 10, 3, 150.0, "meetup").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity",
			"total_price", "status", "payment_method", "created_at", "updated_at",
		}).AddRow(1001, 42, 7, 10, 3, 150.0, "pending", "meetup", now, now))
	mock.ExpectExec("UPDATE listings").
		WithArgs(0, "pending", 10).
		WillReturnError(errors.New("database write failed"))
	mock.ExpectRollback()

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/orders",
		bytes.NewBufferString(`{"items":[{"listingId":10,"quantity":3}]}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", 42)

	if err := createOrders(context, gormDB); err != nil {
		t.Fatalf("createOrders() error = %v", err)
	}
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestGetOrderByIDForbidsUnrelatedUser(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	now := time.Now()

	mock.ExpectQuery("SELECT o.id, o.buyer_id, o.seller_id, o.listing_id").
		WithArgs(99).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity",
			"total_price", "status", "payment_method", "created_at", "updated_at", "payment_status",
		}).AddRow(99, 7, 8, 10, 1, 50.0, "pending", "meetup", now, now, nil))

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/orders/99", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/orders/:id")
	context.SetParamNames("id")
	context.SetParamValues("99")
	context.Set("userId", 42)

	if err := getOrderByID(context, gormDB); err != nil {
		t.Fatalf("getOrderByID() error = %v", err)
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCompleteOrderScopesUpdateToAuthenticatedSeller(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	// Completing an order also sells its listing, so the two writes share a
	// transaction. An order belonging to another seller matches no row, and
	// the whole thing rolls back.
	mock.ExpectBegin()
	mock.ExpectQuery("UPDATE orders").
		WithArgs(99, 42).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	e := echo.New()
	request := httptest.NewRequest(http.MethodPatch, "/orders/99/complete", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/orders/:id/complete")
	context.SetParamNames("id")
	context.SetParamValues("99")
	context.Set("userId", 42)

	if err := completeOrder(context, gormDB); err != nil {
		t.Fatalf("completeOrder() error = %v", err)
	}
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCompleteOrderRequiresPaidStripePayment(t *testing.T) {
	tests := []struct {
		name       string
		paid       bool
		wantStatus int
	}{
		{name: "unpaid", paid: false, wantStatus: http.StatusConflict},
		{name: "paid", paid: true, wantStatus: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			mock.ExpectBegin()
			orderUpdate := mock.ExpectQuery("payments.status = 'paid'").WithArgs(99, 42)
			if test.paid {
				orderUpdate.WillReturnRows(sqlmock.NewRows([]string{"listing_id"}).AddRow(10))
				mock.ExpectExec("UPDATE listings").
					WithArgs(10).
					WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			} else {
				orderUpdate.WillReturnError(sql.ErrNoRows)
				mock.ExpectRollback()
			}

			e := echo.New()
			request := httptest.NewRequest(http.MethodPut, "/orders/99/complete", nil)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.SetPath("/orders/:id/complete")
			context.SetParamNames("id")
			context.SetParamValues("99")
			context.Set("userId", 42)

			if err := completeOrder(context, gormDB); err != nil {
				t.Fatalf("completeOrder() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s",
					recorder.Code, test.wantStatus, recorder.Body.String())
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

func TestSellerPendingOrdersExcludeUnpaidStripeOrders(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("COALESCE\\(o.payment_method, ''\\) <> 'stripe' OR p.status = 'paid'").
		WithArgs(7, "pending").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "buyer_id", "seller_id", "listing_id", "quantity", "total_price",
			"status", "payment_method", "created_at", "updated_at", "title", "image",
			"category", "price", "seller_name", "buyer_username", "buyer_email",
			"payment_status",
		}))

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/seller/orders?status=pending", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", 7)

	if err := getSellerOrders(context, gormDB); err != nil {
		t.Fatalf("getSellerOrders() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}
