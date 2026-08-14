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

// completeImportItem is a row with every required field supplied. Tests start
// from it and break one thing at a time, so a new required field shows up as a
// single fixture change rather than as noise in every case.
func completeImportItem() CreateProductRequest {
	return CreateProductRequest{
		Title:               "Yonex Astrox",
		Price:               200,
		WeightCategory:      "4U",
		FlexibilityCategory: "Medium Flex",
		BalanceCategory:     "Even Balance",
		Location:            "Kuala Lumpur",
		Category:            "Rackets",
		Condition:           "New",
		DealingMethod:       "Meet Up",
	}
}

func TestValidateImportRow(t *testing.T) {
	validOriginalPrice := 250.0
	validStock := 2
	invalidOriginalPrice := -1.0
	invalidStock := 0

	validItem := completeImportItem()
	validItem.OriginalPrice = &validOriginalPrice
	validItem.StockQuantity = &validStock

	badMoney := completeImportItem()
	badMoney.Title = " "
	badMoney.Price = 0
	badMoney.OriginalPrice = &invalidOriginalPrice
	badMoney.StockQuantity = &invalidStock

	// A row carrying only the monetary fields. The dropdown attributes are
	// defaulted exactly as createProduct defaults them, so only the two the
	// sell form refuses to invent are left to report.
	bareRow := CreateProductRequest{Title: "Yonex Astrox", Price: 200}

	// Empty optional cells are the normal CSV shape once a seller deletes the
	// columns they do not care about — they must import, not fail.
	emptyOptionalCells := CreateProductRequest{
		Title:         "Yonex AC102EX Grip",
		Price:         12,
		Location:      "Penang",
		DealingMethod: "Mailing or Delivery",
	}

	// Whitespace-only cells are a real CSV shape. They count as empty, which
	// now means "defaulted" for the dropdown columns and "missing" for the two
	// that are never invented.
	blankCells := completeImportItem()
	blankCells.WeightCategory = "   "
	blankCells.Location = "\t"

	tests := []struct {
		name       string
		item       CreateProductRequest
		wantFields []string
	}{
		{
			name: "accepts a fully specified listing",
			item: validItem,
		},
		{
			name:       "rejects all invalid monetary and stock fields",
			item:       badMoney,
			wantFields: []string{"title", "price", "originalPrice", "stockQuantity"},
		},
		{
			name:       "requires only the attributes the sell form refuses to invent",
			item:       bareRow,
			wantFields: []string{"location", "dealingMethod"},
		},
		{
			name: "accepts a row whose optional cells are all empty",
			item: emptyOptionalCells,
		},
		{
			name:       "defaults whitespace-only dropdown cells but still rejects a blank location",
			item:       blankCells,
			wantFields: []string{"location"},
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
	// The dropdown attributes are defaulted, matching createProduct, so a blank
	// optional cell imports as the value the sell form pre-selects.
	if item.Category != defaultCategory || item.Condition != defaultCondition {
		t.Fatalf("dropdown defaults = (%q, %q), want (%q, %q)",
			item.Category, item.Condition, defaultCategory, defaultCondition)
	}
	// The category defaulted to "Others", so the racket specs must come out
	// cleared rather than stamped with "4U / Medium Flex / Even Balance".
	if item.WeightCategory != "" || item.FlexibilityCategory != "" || item.BalanceCategory != "" {
		t.Fatalf("racket specs survived onto a non-racket listing: %+v", item)
	}
	// location and dealingMethod are never invented — validateImportRow rejects
	// a row that omits them, so they must come out exactly as supplied.
	if item.Location != "" || item.DealingMethod != "" {
		t.Fatalf("location/dealingMethod were invented rather than left as supplied: %+v", item)
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
	mock.ExpectQuery(`SELECT .*username.* FROM ["']?users["']?`).
		WithArgs(42, 1).
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("Trusted Seller"))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO listings").
		WithArgs(
			42, "First", "", "4U", "Medium Flex", "Even Balance",
			100.0, nil, "Kuala Lumpur", "", "Trusted Seller", false, false,
			"Rackets", "New", "Meet Up", "", 1,
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(101))
	mock.ExpectQuery("INSERT INTO listings").
		WithArgs(
			42, "Second", "", "4U", "Medium Flex", "Even Balance",
			200.0, nil, "Kuala Lumpur", "", "Trusted Seller", false, false,
			"Rackets", "New", "Meet Up", "", 1,
		).
		WillReturnError(errors.New("second insert failed"))
	mock.ExpectRollback()

	// Both rows carry every required attribute so the batch reaches the inserts
	// — this test is about transaction rollback, not validation.
	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/products/import",
		bytes.NewBufferString(`{
			"items": [
				{"sellerId": 999, "title": "First", "price": 100,
				 "weightCategory": "4U", "flexibilityCategory": "Medium Flex",
				 "balanceCategory": "Even Balance", "location": "Kuala Lumpur",
				 "category": "Rackets", "condition": "New", "dealingMethod": "Meet Up"},
				{"sellerId": 999, "title": "Second", "price": 200,
				 "weightCategory": "4U", "flexibilityCategory": "Medium Flex",
				 "balanceCategory": "Even Balance", "location": "Kuala Lumpur",
				 "category": "Rackets", "condition": "New", "dealingMethod": "Meet Up"}
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
