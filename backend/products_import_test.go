package main

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func TestValidateImportRow(t *testing.T) {
	validOriginalPrice := 250.0
	validStock := 2
	invalidOriginalPrice := -1.0
	invalidStock := 0

	tests := []struct {
		name       string
		item       CreateProductRequest
		wantFields []string
	}{
		{
			name: "accepts a valid listing",
			item: CreateProductRequest{
				Title:         "Yonex Astrox",
				Price:         200,
				OriginalPrice: &validOriginalPrice,
				StockQuantity: &validStock,
			},
		},
		{
			name: "rejects all invalid monetary and stock fields",
			item: CreateProductRequest{
				Title:         " ",
				Price:         0,
				OriginalPrice: &invalidOriginalPrice,
				StockQuantity: &invalidStock,
			},
			wantFields: []string{"title", "price", "originalPrice", "stockQuantity"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			errors := validateImportRow(7, test.item)
			gotFields := make([]string, 0, len(errors))
			for _, item := range errors {
				if item.Row != 7 {
					t.Fatalf("error row = %d, want 7", item.Row)
				}
				gotFields = append(gotFields, item.Field)
			}

			if !slices.Equal(gotFields, test.wantFields) {
				t.Fatalf("error fields = %v, want %v", gotFields, test.wantFields)
			}
		})
	}
}

func TestApplyImportDefaultsUsesTrustedSellerIdentity(t *testing.T) {
	item := CreateProductRequest{
		SellerID:   999,
		SellerName: "Attacker supplied name",
		Title:      "Valid racket",
		Price:      100,
	}

	applyImportDefaults(&item, 42, "Trusted Seller")

	if item.SellerID != 42 || item.SellerName != "Trusted Seller" {
		t.Fatalf("seller identity = (%d, %q), want (42, %q)", item.SellerID, item.SellerName, "Trusted Seller")
	}
	if item.Location != "Malaysia" ||
		item.WeightCategory != "4U" ||
		item.FlexibilityCategory != "Medium Flex" ||
		item.BalanceCategory != "Even Balance" ||
		item.Category != "Others" ||
		item.Condition != "Second-hand (Used)" ||
		item.DealingMethod != "Meet Up" {
		t.Fatalf("defaults were not applied correctly: %+v", item)
	}
}

func TestApplyImportDefaultsPreservesProvidedListingValues(t *testing.T) {
	item := CreateProductRequest{
		Location:            "Kuala Lumpur",
		WeightCategory:      "3U",
		FlexibilityCategory: "Stiff Shaft",
		BalanceCategory:     "Head Heavy",
		Category:            "Rackets",
		Condition:           "New",
		DealingMethod:       "Delivery",
	}

	applyImportDefaults(&item, 8, "Seller")

	if item.Location != "Kuala Lumpur" ||
		item.WeightCategory != "3U" ||
		item.FlexibilityCategory != "Stiff Shaft" ||
		item.BalanceCategory != "Head Heavy" ||
		item.Category != "Rackets" ||
		item.Condition != "New" ||
		item.DealingMethod != "Delivery" {
		t.Fatalf("provided listing values were overwritten: %+v", item)
	}
}

func TestImportProductsRollsBackEntireBatchWhenOneInsertFails(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT username FROM users WHERE id").
		WithArgs(42).
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("Trusted Seller"))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO listings").
		WithArgs(
			42, "First", "", "4U", "Medium Flex", "Even Balance",
			100.0, nil, "Malaysia", "", "Trusted Seller", false, false,
			"Others", "Second-hand (Used)", "Meet Up", "", 1,
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(101))
	mock.ExpectQuery("INSERT INTO listings").
		WithArgs(
			42, "Second", "", "4U", "Medium Flex", "Even Balance",
			200.0, nil, "Malaysia", "", "Trusted Seller", false, false,
			"Others", "Second-hand (Used)", "Meet Up", "", 1,
		).
		WillReturnError(errors.New("second insert failed"))
	mock.ExpectRollback()

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/products/import",
		bytes.NewBufferString(`{
			"items": [
				{"sellerId": 999, "title": "First", "price": 100},
				{"sellerId": 999, "title": "Second", "price": 200}
			]
		}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", 42)

	if err := importProducts(context, gormDB); err != nil {
		t.Fatalf("importProducts() error = %v", err)
	}
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	expectNoOutstandingSQL(t, mock)
}
