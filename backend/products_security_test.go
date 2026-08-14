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
		name         string
		sellerID     int
		listingState string
		checkOrders  bool
		orderCount   int
		allowDelete  bool
		wantStatus   int
	}{
		{name: "different seller forbidden", sellerID: 7, listingState: "active", wantStatus: http.StatusForbidden},
		{name: "owner allowed", sellerID: 42, listingState: "active", checkOrders: true, allowDelete: true, wantStatus: http.StatusOK},
		// Orders are financial history for the buyer too, so a listing that has
		// any is refused rather than taking the order rows down with it.
		{name: "listing with orders refused", sellerID: 42, listingState: "active", checkOrders: true, orderCount: 3, wantStatus: http.StatusConflict},
		// A terminal status is refused on its own, without consulting orders: a
		// listing goes 'sold' when its stock hits zero, so it can reach that
		// state with no order rows to catch it.
		{name: "sold listing refused", sellerID: 42, listingState: "sold", wantStatus: http.StatusConflict},
		{name: "pending listing refused", sellerID: 42, listingState: "pending", wantStatus: http.StatusConflict},
		// Archiving is what the refusal messages tell sellers to do, so it must
		// not itself become undeletable.
		{name: "archived listing still deletable", sellerID: 42, listingState: "archived", checkOrders: true, allowDelete: true, wantStatus: http.StatusOK},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			// Loose matcher because loadListingSellerAndStatus goes through GORM,
			// which quotes the table and appends ORDER BY / LIMIT. The second
			// arg is that LIMIT parameter. status is returned so the sold,
			// pending and archived cases below exercise the state guard.
			mock.ExpectQuery(`SELECT .*seller_id.* FROM ["']?listings["']?`).
				WithArgs(10, 1).
				WillReturnRows(sqlmock.NewRows([]string{"seller_id", "status"}).AddRow(test.sellerID, test.listingState))
			if test.checkOrders {
				mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM orders WHERE listing_id").
					WithArgs(10).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(test.orderCount))
			}
			if test.allowDelete {
				mock.ExpectExec(`DELETE FROM ["']?listings["']?`).
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
	// updateProduct loads the pre-edit row through loadListingForUpdate, which is
	// still a single raw-SQL SELECT of eleven columns — hence one bind arg and no
	// LIMIT. seller_id 7 against userId 42 below is what must trigger the 403.
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{
			"seller_id", "title", "description", "price", "location",
			"category", "weight_category", "flexibility_category", "balance_category",
			"status", "stock_quantity",
		}).AddRow(7, "Old", "", 100.0, "KL",
			"Rackets", "4U", "Medium Flex", "Even Balance", "active", 3))

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

	expectHandled(t, updateProduct(context, gormDB))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	expectNoOutstandingSQL(t, mock)
}

// A listing goes 'pending' when a buyer checks out and stays there until the
// seller confirms delivery or the order is cancelled. completeOrder and
// cancelOrder both finish with `AND status = 'pending'`, so letting an edit
// rewrite the status in that window would make those updates match nothing and
// strand the listing. The owner is refused as firmly as a stranger, and the
// refusal must land before any mutation.
func TestUpdateProductRefusesListingAwaitingDelivery(t *testing.T) {
	tests := []struct {
		name       string
		status     string
		wantStatus int
	}{
		{name: "pending refused", status: "pending", wantStatus: http.StatusConflict},
		// 'sold' is refused for a different reason: the sale is done, and the
		// row is the history the dashboard reports from. See
		// TestUpdateProductRefusesRepublishingASoldListing for the way round it.
		{name: "sold refused", status: "sold", wantStatus: http.StatusConflict},
		// Nothing is in flight on these two, so a seller may still fix a typo.
		{name: "active editable", status: "active", wantStatus: http.StatusOK},
		{name: "archived editable", status: "archived", wantStatus: http.StatusOK},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			// loadListingForUpdate reads eleven columns in one raw SELECT, so a
			// single bind arg. The guard it applies is the same for both update
			// surfaces; this exercises it through the API-key one because the
			// body below is a partial patch.
			mock.ExpectQuery("SELECT seller_id, title, description, price, location").
				WithArgs(10).
				WillReturnRows(sqlmock.NewRows([]string{
					"seller_id", "title", "description", "price", "location",
					"category", "weight_category", "flexibility_category", "balance_category",
					"status", "stock_quantity",
				}).AddRow(42, "Old title", "", 80.0, "Kuala Lumpur",
					"Rackets", "4U", "Medium Flex", "Even Balance", test.status, 3))
			if test.wantStatus == http.StatusOK {
				mock.ExpectExec(`UPDATE ["']?listings["']?`).
					WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery("SELECT (.+) FROM listings").
					WithArgs(10).
					WillReturnError(errors.New("stop after the update is allowed through"))
			}

			e := echo.New()
			request := httptest.NewRequest(
				http.MethodPut,
				"/products/10",
				bytes.NewBufferString(`{"title":"Reprice mid-sale","price":999}`),
			)
			request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.SetPath("/products/:id")
			context.SetParamNames("id")
			context.SetParamValues("10")
			context.Set("userId", 42)

			expectHandled(t, updateProductForAPIKey(context, gormDB))
			// The allowed cases are cut short at the read-back query, which
			// reports 500. What matters is that they got past the guard and
			// reached the UPDATE, which ExpectExec above asserts.
			if test.wantStatus == http.StatusOK {
				if recorder.Code == http.StatusConflict {
					t.Fatalf("status %q was refused, want the edit allowed through", test.status)
				}
			} else if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

// A listing sells as one whole lot exactly once, so an item that has changed
// hands never goes back on the market -- a seller with another one posts a new
// listing. Refusing to edit a 'sold' row is not enough on its own: archiving is
// still allowed after a sale, and Republish is an ordinary status edit on an
// archived row, which would walk a sold item back to 'active' the long way.
//
// The listing's own status cannot answer this, because by then it reads
// 'archived'. Only the order history can, so that is what the guard reads.
func TestUpdateProductRefusesRepublishingASoldListing(t *testing.T) {
	tests := []struct {
		name            string
		completedOrders int
		wantStatus      int
	}{
		{name: "sold before, republish refused", completedOrders: 1, wantStatus: http.StatusConflict},
		// Archived without ever selling is an ordinary withdrawn listing, and
		// Republish has to keep working for it.
		{name: "never sold, republish allowed", completedOrders: 0, wantStatus: http.StatusOK},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			// The listing reads 'archived' by now, which is exactly why its own
			// status cannot answer the question — only the order history can.
			mock.ExpectQuery("SELECT seller_id, title, description, price, location").
				WithArgs(10).
				WillReturnRows(sqlmock.NewRows([]string{
					"seller_id", "title", "description", "price", "location",
					"category", "weight_category", "flexibility_category", "balance_category",
					"status", "stock_quantity",
				}).AddRow(42, "Old title", "", 80.0, "Kuala Lumpur",
					"Rackets", "4U", "Medium Flex", "Even Balance", "archived", 1))
			mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM orders WHERE listing_id").
				WithArgs(10).
				WillReturnRows(
					sqlmock.NewRows([]string{"count"}).AddRow(test.completedOrders),
				)
			if test.wantStatus == http.StatusOK {
				mock.ExpectExec(`UPDATE ["']?listings["']?`).
					WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery("SELECT (.+) FROM listings").
					WithArgs(10).
					WillReturnError(errors.New("stop after the update is allowed through"))
			}

			// Republish is a whole-form edit carrying status=active, the same
			// shape My Shop's button sends.
			e := echo.New()
			request := httptest.NewRequest(
				http.MethodPut,
				"/products/10",
				bytes.NewBufferString(`{"title":"Back on sale","price":120,"status":"active",`+
					`"category":"Rackets","condition":"New","dealingMethod":"Meet Up",`+
					`"phoneNumber":"","description":"","originalPrice":null,"stockQuantity":1,`+
					`"location":"Kuala Lumpur","weightCategory":"4U",`+
					`"flexibilityCategory":"Medium Flex","balanceCategory":"Even Balance"}`),
			)
			request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.SetPath("/products/:id")
			context.SetParamNames("id")
			context.SetParamValues("10")
			context.Set("userId", 42)

			expectHandled(t, updateProduct(context, gormDB))
			if test.wantStatus == http.StatusOK {
				if recorder.Code == http.StatusConflict {
					t.Fatalf("republish was refused, want it allowed through")
				}
			} else if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

// An edit that says nothing about status must leave the listing where it is.
// The status field defaulted to "active", so any caller that omitted it --
// routine for a hand-written developer-API client -- silently republished an
// archived listing as a side effect of fixing a typo.
//
// Aimed at the API-key handler because that is the surface where partial bodies
// are the norm; the JWT handler is a whole-form replace and echoes the status
// back, which TestUpdateProductIgnoresClientSuppliedStatus covers instead.
func TestUpdateProductForAPIKeyKeepsStatusWhenOmitted(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	// loadListingForUpdate is one raw SELECT of eleven columns, so a single
	// bind arg and no LIMIT.
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(10).
		WillReturnRows(
			sqlmock.NewRows([]string{
				"seller_id", "title", "description", "price", "location",
				"category", "weight_category", "flexibility_category", "balance_category",
				"status", "stock_quantity",
			}).AddRow(42, "Old title", "Old description", 80.0, "Old location",
				"Rackets", "4U", "Medium Flex", "Even Balance",
				"archived", 2),
		)
	// Only title and price were sent; everything else keeps its stored value,
	// and "archived" surviving here is the whole point of the test.
	mock.ExpectExec(`UPDATE ["']?listings["']?`).
		WithArgs("Typo fixed", "Old description", 120.0, "Old location",
			"Rackets", "4U", "Medium Flex", "Even Balance", "archived", 2, 10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT (.+) FROM listings").
		WithArgs(10).
		WillReturnError(errors.New("stop after the update is allowed through"))

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPut,
		"/products/10",
		bytes.NewBufferString(`{"title":"Typo fixed","price":120}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/products/:id")
	context.SetParamNames("id")
	context.SetParamValues("10")
	context.Set("userId", 42)

	expectHandled(t, updateProductForAPIKey(context, gormDB))
	if recorder.Code == http.StatusConflict {
		t.Fatalf("edit was refused, want it allowed through")
	}
	expectNoOutstandingSQL(t, mock)
}

// Same reasoning as the test above: a partial body belongs to the API-key
// surface, so this exercises updateProductForAPIKey.
func TestUpdateProductForAPIKeyPartialPayloadPreservesOtherFields(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(10).
		WillReturnRows(
			sqlmock.NewRows([]string{
				"seller_id", "title", "description", "price", "location",
				"category", "weight_category", "flexibility_category", "balance_category",
				"status", "stock_quantity",
			}).AddRow(42, "Old title", "Old description", 80.0, "Old location",
				"Rackets", "4U", "Medium Flex", "Even Balance",
				"active", 5),
		)
	mock.ExpectExec(`UPDATE ["']?listings["']?`).
		WithArgs("New title", "Old description", 99.0, "Old location",
			"Rackets", "4U", "Medium Flex", "Even Balance", "active", 5, 10).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT (.+) FROM listings").
		WithArgs(10).
		WillReturnError(errors.New("stop after the update is allowed through"))

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPut,
		"/products/10",
		bytes.NewBufferString(`{"title":"New title","price":99}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/products/:id")
	context.SetParamNames("id")
	context.SetParamValues("10")
	context.Set("userId", 42)

	expectHandled(t, updateProductForAPIKey(context, gormDB))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateProductUsesAuthenticatedSellerInsteadOfBodySellerID(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery(`SELECT .*username.* FROM ["']?users["']?`).
		WithArgs(42, 1).
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("Trusted Seller"))
	mock.ExpectQuery(`INSERT INTO ["']?listings["']?`).
		WithArgs(
			42, "Racket", "", "4U", "Medium Flex", "Even Balance",
			// Column order follows the listingRow struct, which is what GORM
			// builds the INSERT from — category/condition/dealingMethod/phone
			// come before price. Values are the ones this request body sends.
			"Rackets", "New", "Meet Up", "",
			100.0, nil, "Kuala Lumpur", "", "Trusted Seller", false, false, 1, "active",
		).
		WillReturnError(errors.New("stop after verifying trusted arguments"))

	// The body supplies every required listing attribute so the request reaches
	// the INSERT; the point of this test is that sellerId, sellerName and image
	// in the body are discarded. The expected args above assert image lands as
	// "" — a caller-supplied URL must never reach the column the storefront
	// renders as an <img src>.
	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/products",
		bytes.NewBufferString(`{"sellerId":999,"sellerName":"Attacker","title":"Racket","price":100,
			"image":"https://attacker.example/tracker.gif",
			"weightCategory":"4U","flexibilityCategory":"Medium Flex","balanceCategory":"Even Balance",
			"location":"Kuala Lumpur","category":"Rackets","condition":"New","dealingMethod":"Meet Up"}`),
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

// Post an Ad pre-selects five dropdowns and blocks submit on only four fields:
// title, price, location and dealingMethod. createProduct fills the same five
// so an API caller faces the same required set as someone using the form, and
// lands on the same listing when clicking straight through.
//
// The defaults are asserted by value, not merely as "non-empty": a listing
// created through the API must be indistinguishable from one the GUI produced,
// and every value here is a member of the matching list in productOptions.ts.
func TestApplyListingDefaultsMatchesTheSellForm(t *testing.T) {
	// A blank category resolves to "Others", so the racket specs are cleared
	// rather than defaulted — see the sub-test further down. Only the two
	// category-independent dropdowns survive here.
	t.Run("blank fields take the form's pre-selected values", func(t *testing.T) {
		req := CreateProductRequest{Title: "Racket", Price: 10}
		applyListingDefaults(&req)

		for _, field := range []struct{ name, got, want string }{
			{"category", req.Category, "Others"},
			{"condition", req.Condition, "Second-hand (Used)"},
			{"weightCategory", req.WeightCategory, ""},
			{"flexibilityCategory", req.FlexibilityCategory, ""},
			{"balanceCategory", req.BalanceCategory, ""},
		} {
			if field.got != field.want {
				t.Errorf("%s = %q, want %q", field.name, field.got, field.want)
			}
		}
	})

	// The racket specs do have form defaults; they only survive on a listing
	// that is actually a racket.
	t.Run("racket specs default when the category is Rackets", func(t *testing.T) {
		req := CreateProductRequest{Title: "Racket", Price: 10, Category: "Rackets"}
		applyListingDefaults(&req)

		if req.WeightCategory != "4U" ||
			req.FlexibilityCategory != "Medium Flex" ||
			req.BalanceCategory != "Even Balance" {
			t.Fatalf("racket specs were not defaulted: %+v", req)
		}
	})

	// Whitespace is treated as absent, matching the TrimSpace check in
	// missingListingFields that runs immediately after.
	t.Run("whitespace-only counts as blank", func(t *testing.T) {
		req := CreateProductRequest{Category: "   ", WeightCategory: "\t"}
		applyListingDefaults(&req)
		// Category fell back, and the whitespace weight was cleared with the
		// rest of the racket specs because "Others" is not a racket.
		if req.Category != "Others" || req.WeightCategory != "" {
			t.Fatalf("whitespace was kept: category %q weightCategory %q", req.Category, req.WeightCategory)
		}
	})

	t.Run("supplied values are never overwritten", func(t *testing.T) {
		req := completeImportItem()
		applyListingDefaults(&req)
		if req.Category != "Rackets" || req.Condition != "New" || req.WeightCategory != "4U" {
			t.Fatalf("a supplied value was replaced: %+v", req)
		}
	})

	t.Run("non-racket categories clear racket-only specs", func(t *testing.T) {
		req := CreateProductRequest{
			Category:            "Accessories",
			WeightCategory:      "4U",
			FlexibilityCategory: "Medium Flex",
			BalanceCategory:     "Even Balance",
			Title:               "Bag",
			Price:               50,
			Location:            "Kuala Lumpur",
			DealingMethod:       "Meet Up",
		}
		applyListingDefaults(&req)
		if req.WeightCategory != "" || req.FlexibilityCategory != "" || req.BalanceCategory != "" {
			t.Fatalf("non-racket category kept racket specs: %+v", req)
		}
	})

	// The point of the whole exercise: after defaulting, the only fields that
	// can still fail are the two the sell form also refuses to invent. If a
	// future default covers one of these, the API becomes MORE lenient than the
	// GUI and this fails.
	t.Run("location and dealingMethod stay required", func(t *testing.T) {
		req := CreateProductRequest{Title: "Racket", Price: 10}
		applyListingDefaults(&req)

		missing := missingListingFields(req)
		if len(missing) != 2 {
			t.Fatalf("missing = %+v, want exactly location and dealingMethod", missing)
		}
		for _, field := range missing {
			if field.Field != "location" && field.Field != "dealingMethod" {
				t.Errorf("unexpected required field after defaulting: %q", field.Field)
			}
		}
	})

	// Bulk import applies the same defaults, so a blank spreadsheet cell behaves
	// exactly like a blank field on a single-listing POST. That leaves the same
	// two fields able to fail, and only those two.
	t.Run("bulk import defaults like the single-listing API", func(t *testing.T) {
		errs := validateImportRow(1, CreateProductRequest{Title: "Racket", Price: 10})
		if len(errs) != 2 {
			t.Fatalf("import row errors = %d, want 2 — only location and dealingMethod survive defaulting", len(errs))
		}
		for _, e := range errs {
			if e.Field != "location" && e.Field != "dealingMethod" {
				t.Errorf("unexpected required import field after defaulting: %q", e.Field)
			}
		}
	})
}
