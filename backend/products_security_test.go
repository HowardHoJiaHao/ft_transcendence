package main

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func TestDeleteProductEnforcesOwnership(t *testing.T) {
	tests := []struct {
		name        string
		sellerID    int
		checkOrders bool
		orderCount  int
		allowDelete bool
		wantStatus  int
	}{
		{name: "different seller forbidden", sellerID: 7, wantStatus: http.StatusForbidden},
		{name: "owner allowed", sellerID: 42, checkOrders: true, allowDelete: true, wantStatus: http.StatusOK},
		// Orders are financial history for the buyer too, so a listing that has
		// any is refused rather than taking the order rows down with it.
		{name: "listing with orders refused", sellerID: 42, checkOrders: true, orderCount: 3, wantStatus: http.StatusConflict},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			mock.ExpectQuery("SELECT seller_id FROM listings WHERE id").
				WithArgs(10).
				WillReturnRows(sqlmock.NewRows([]string{"seller_id"}).AddRow(test.sellerID))
			if test.checkOrders {
				mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM orders WHERE listing_id").
					WithArgs(10).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(test.orderCount))
			}
			if test.allowDelete {
				mock.ExpectExec("DELETE FROM listings WHERE id").
					WithArgs(10).
					WillReturnResult(sqlmock.NewResult(0, 1))
			}

			e := echo.New()
			request := httptest.NewRequest(http.MethodDelete, "/products/10", nil)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.SetPath("/products/:id")
			context.SetParamNames("id")
			context.SetParamValues("10")
			context.Set("userId", 42)

			if err := deleteProduct(context, gormDB); err != nil {
				t.Fatalf("deleteProduct() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

func TestUpdateProductRejectsDifferentSellerBeforeMutation(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT seller_id, stock_quantity FROM listings WHERE id").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"seller_id", "stock_quantity"}).AddRow(7, 3))

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPut,
		"/products/10",
		bytes.NewBufferString(`{"title":"Stolen edit","price":1}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/products/:id")
	context.SetParamNames("id")
	context.SetParamValues("10")
	context.Set("userId", 42)

	if err := updateProduct(context, gormDB); err != nil {
		t.Fatalf("updateProduct() error = %v", err)
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateProductUsesAuthenticatedSellerInsteadOfBodySellerID(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT username FROM users WHERE id").
		WithArgs(42).
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("Trusted Seller"))
	mock.ExpectQuery("INSERT INTO listings").
		WithArgs(
			42, "Racket", "", "4U", "Medium Flex", "Even Balance",
			100.0, nil, "Malaysia", "", "Trusted Seller", false, false,
			"Others", "Second-hand (Used)", "Meet Up", "", 1,
		).
		WillReturnError(errors.New("stop after verifying trusted arguments"))

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/products",
		bytes.NewBufferString(`{"sellerId":999,"sellerName":"Attacker","title":"Racket","price":100}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", 42)

	if err := createProduct(context, gormDB); err != nil {
		t.Fatalf("createProduct() error = %v", err)
	}
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	expectNoOutstandingSQL(t, mock)
}
