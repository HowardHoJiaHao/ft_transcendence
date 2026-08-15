package main

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

const apiKeyCallerID = 42

func newAPIKeyRequest(t *testing.T, target string, withIdentity bool) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	if withIdentity {
		context.Set("userId", apiKeyCallerID)
	}
	return context, recorder
}

// The headline guarantee: however the caller phrases the request, the SQL is
// filtered to their own account. Asserting on the query ARGUMENT rather than
// the response is deliberate — getProductsForAPIKey enforces the scope by
// mutating Echo's cached query map, so this fails if that mechanism ever stops
// working, instead of the endpoint quietly returning the whole marketplace.
func TestProductJSONOmitsInternalFlags(t *testing.T) {
	payload, err := json.Marshal(Product{
		ID:         1,
		Title:      "Example",
		Price:      99.9,
		IsNew:      false,
		IsFeatured: false,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if bytes.Contains(payload, []byte("\"isNew\"")) || bytes.Contains(payload, []byte("\"isFeatured\"")) {
		t.Fatalf("response payload unexpectedly includes internal product flags: %s", payload)
	}
}

func TestPublicProductAPIRejectsUnknownQueryParams(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	context, recorder := newAPIKeyRequest(t, "/api/public/v1/products?foo=bar", true)
	if err := getProductsForAPIKey(context, gormDB); err != nil {
		t.Fatalf("getProductsForAPIKey() error = %v", err)
	}
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if mock.ExpectationsWereMet() != nil {
		t.Fatal("unexpected SQL was executed")
	}
}

func TestPublicProductAPIRejectsUnknownJSONFields(t *testing.T) {
	e := echo.New()
	body := `{"title":"Example","price":99.9,"notARealField":true}`
	request := httptest.NewRequest(http.MethodPost, "/api/public/v1/products", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userId", apiKeyCallerID)

	// The unknown field is rejected before any query runs, so the mock goes
	// unused here — only the *gorm.DB half of the helper is needed.
	gormDB, _ := newTestGormDB(t)
	expectHandled(t, createProduct(context, gormDB))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestGetProductsForAPIKeyAlwaysFiltersToCaller(t *testing.T) {
	for _, test := range []struct {
		name string
		// wantArgs is the full argument list the count query must receive. The
		// caller's id is always first because getProducts appends the sellerId
		// filter before status.
		query    string
		wantArgs []driver.Value
	}{
		{name: "no filters supplied", query: "", wantArgs: []driver.Value{apiKeyCallerID}},
		// The supported filters, alone and together. Only status reaches the
		// COUNT query as a bind argument: sort just picks an ORDER BY branch,
		// and limit is applied to the page query, not the count.
		{name: "status supplied", query: "?status=active", wantArgs: []driver.Value{apiKeyCallerID, "active"}},
		{name: "sort supplied", query: "?sort=price-high", wantArgs: []driver.Value{apiKeyCallerID}},
		{name: "limit supplied", query: "?limit=5", wantArgs: []driver.Value{apiKeyCallerID}},
		{name: "all supported filters", query: "?sort=price-low&status=sold&limit=50", wantArgs: []driver.Value{apiKeyCallerID, "sold"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			// The assertion is WithArgs: the caller's id must reach the WHERE
			// clause. A missing or different arg fails the expectation.
			mock.ExpectQuery("SELECT COUNT").
				WithArgs(test.wantArgs...).
				WillReturnError(errors.New("stop after the scope check"))

			context, recorder := newAPIKeyRequest(t, "/api/public/v1/products"+test.query, true)
			if err := getProductsForAPIKey(context, gormDB); err != nil {
				t.Fatalf("getProductsForAPIKey() error = %v", err)
			}
			if recorder.Code == http.StatusForbidden || recorder.Code == http.StatusBadRequest {
				t.Fatalf("status = %d: guard blocked a request it should have allowed", recorder.Code)
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

// The developer API accepts only limit, sort and status. Every other filter
// getProducts understands must be refused before a query runs — a silently
// dropped filter would hand back a result set that does not match what was
// asked for, which is worse than an error.
func TestGetProductsForAPIKeyRejectsUnsupportedParams(t *testing.T) {
	for _, test := range []struct {
		name         string
		query        string
		withIdentity bool
		wantStatus   int
	}{
		// sellerId is refused whoever it names, including the caller's own id:
		// scoping is forced from the API key, never requested by the caller.
		{name: "another seller refused", query: "?sellerId=7", withIdentity: true, wantStatus: http.StatusBadRequest},
		{name: "own sellerId refused", query: "?sellerId=42", withIdentity: true, wantStatus: http.StatusBadRequest},
		// limit is supported, offset is not: page size is adjustable, paging
		// past the first page is not.
		{name: "offset refused", query: "?offset=10", withIdentity: true, wantStatus: http.StatusBadRequest},
		{name: "search refused", query: "?search=astrox", withIdentity: true, wantStatus: http.StatusBadRequest},
		{name: "price range refused", query: "?minPrice=10&maxPrice=99", withIdentity: true, wantStatus: http.StatusBadRequest},
		{name: "racket specs refused", query: "?weightCategory=4U", withIdentity: true, wantStatus: http.StatusBadRequest},
		// Supported filters alongside an unsupported one are still refused —
		// partial honouring is the outcome this guard exists to prevent.
		{name: "mixed supported and not", query: "?status=active&limit=5&search=x", withIdentity: true, wantStatus: http.StatusBadRequest},
		// Guards against the route ever losing its middleware: with no identity
		// there is nothing to scope to, so refuse rather than serve everything.
		{name: "missing identity unauthorized", query: "", withIdentity: false, wantStatus: http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			// No expectations: every case must be refused before any query runs.
			gormDB, mock := newTestGormDB(t)

			context, recorder := newAPIKeyRequest(t, "/api/public/v1/products"+test.query, test.withIdentity)
			if err := getProductsForAPIKey(context, gormDB); err != nil {
				t.Fatalf("getProductsForAPIKey() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

func TestGetProductByIDForAPIKeyEnforcesOwnership(t *testing.T) {
	for _, test := range []struct {
		name        string
		sellerID    int
		noRows      bool
		wantStatus  int
		wantFullGet bool
	}{
		// Both "belongs to someone else" and "does not exist" answer 404, so the
		// endpoint cannot be walked to discover which listing ids exist.
		{name: "another seller's listing hidden", sellerID: 7, wantStatus: http.StatusNotFound},
		{name: "missing listing", noRows: true, wantStatus: http.StatusNotFound},
		{name: "own listing allowed", sellerID: apiKeyCallerID, wantFullGet: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			gormDB, mock := newTestGormDB(t)
			ownership := mock.ExpectQuery("SELECT seller_id FROM listings WHERE id").WithArgs(10)
			if test.noRows {
				ownership.WillReturnRows(sqlmock.NewRows([]string{"seller_id"}))
			} else {
				ownership.WillReturnRows(sqlmock.NewRows([]string{"seller_id"}).AddRow(test.sellerID))
			}
			if test.wantFullGet {
				// Only the owner should get as far as the real fetch.
				mock.ExpectQuery("SELECT").WillReturnError(errors.New("stop after the ownership check"))
			}

			e := echo.New()
			request := httptest.NewRequest(http.MethodGet, "/api/public/v1/products/10", nil)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.SetPath("/products/:id")
			context.SetParamNames("id")
			context.SetParamValues("10")
			context.Set("userId", apiKeyCallerID)

			if err := getProductByIDForAPIKey(context, gormDB); err != nil {
				t.Fatalf("getProductByIDForAPIKey() error = %v", err)
			}
			if test.wantFullGet {
				if recorder.Code == http.StatusNotFound {
					t.Fatal("the owner was refused their own listing")
				}
			} else if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			expectNoOutstandingSQL(t, mock)
		})
	}
}

// The browser-facing handlers must stay open: the marketplace home page, search
// and the seller shop page all read listings the viewer does not own, and
// GET /api/v1/products takes no login at all. This guards against someone
// "tidying up" by moving the scope check into the shared handler.
func TestBrowserProductHandlersStayUnscoped(t *testing.T) {
	t.Run("list accepts another seller's id", func(t *testing.T) {
		gormDB, mock := newTestGormDB(t)
		mock.ExpectQuery("SELECT COUNT").
			WithArgs(7).
			WillReturnError(errors.New("stop after the filter is built"))

		context, recorder := newAPIKeyRequest(t, "/api/v1/products?sellerId=7", false)
		if err := getProducts(context, gormDB); err != nil {
			t.Fatalf("getProducts() error = %v", err)
		}
		if recorder.Code == http.StatusForbidden || recorder.Code == http.StatusUnauthorized {
			t.Fatalf("status = %d: getProducts must stay open, the seller shop page depends on it", recorder.Code)
		}
		expectNoOutstandingSQL(t, mock)
	})
}
