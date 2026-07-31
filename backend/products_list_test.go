package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func TestGetProductsKeepsSoldOutListingsInPublicBrowse(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	publicVisibility := `(?s)l\.status = 'active'.*l\.status IN \('pending', 'sold'\).*COALESCE\(l\.stock_quantity, 0\) = 0`
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*` + publicVisibility).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT l\.id.*`+publicVisibility+`.*LIMIT \$1 OFFSET \$2`).
		WithArgs(20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/products", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)

	if err := getProducts(context, gormDB); err != nil {
		t.Fatalf("getProducts() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte(`"total":0`)) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestGetProductsNewestSortsSoldOutListingsLast(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	publicVisibility := `(?s)l\.status = 'active'.*l\.status IN \('pending', 'sold'\).*COALESCE\(l\.stock_quantity, 0\) = 0`
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*` + publicVisibility).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT l\.id.*`+publicVisibility+`.*ORDER BY CASE WHEN l\.status <> 'active' OR COALESCE\(l\.stock_quantity, 0\) = 0 THEN 1 ELSE 0 END ASC, l\.id DESC.*LIMIT \$1 OFFSET \$2`).
		WithArgs(20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/products?sort=newest", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)

	if err := getProducts(context, gormDB); err != nil {
		t.Fatalf("getProducts() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}
