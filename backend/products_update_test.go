package main

// Regression tests for the two update surfaces.
//
// These exist because the routes used to SHARE one handler bound to
// UpdateProductRequest, which has no fields for condition, dealingMethod,
// phoneNumber, originalPrice or the racket specs. The sell page's edit form
// sends all of them, so every edit from the UI was rejected — and because
// bindStrictJSON returned c.JSON's nil, the handler carried on past the
// rejection, wrote a SECOND JSON document into the same response and ran the
// UPDATE anyway. The browser could not parse the two concatenated objects, so it
// showed a generic "Failed to update listing" while the write had happened and
// the image upload that followed the save was skipped.

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

// currentListingRow is the pre-edit row loadListingForUpdate reads.
func currentListingRow() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"seller_id", "title", "description", "price", "location",
		"category", "weight_category", "flexibility_category", "balance_category",
		"status", "stock_quantity",
	}).AddRow(42, "Old title", "old desc", 100.0, "Kuala Lumpur",
		"Rackets", "4U", "Medium Flex", "Even Balance", "active", 1)
}

// updatedListingRow is what fetchProductByID returns after a successful write.
func updatedListingRow() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "title", "price", "original_price", "image",
		"category", "condition", "dealing_method", "phone_number",
		"weight_category", "flexibility_category", "balance_category",
		"location", "seller_id", "seller_name", "seller_avatar", "rating", "reviews",
		"is_new", "is_featured", "stock_quantity", "status", "views_count",
		"created_at", "description",
	}).AddRow(60, "My Racket", 99.0, nil, "",
		"Rackets", "New", "Meet Up", "0123456789",
		"4U", "Medium Flex", "Even Balance",
		"Kuala Lumpur", 42, "Seller", "", 0.0, 0,
		false, false, 1, "active", 0,
		time.Now(), "d")
}

// editFormBody is byte-for-byte what sell/page.tsx submits in edit mode.
const editFormBody = `{"category":"Rackets","condition":"New","dealingMethod":"Meet Up",` +
	`"phoneNumber":"0123456789","title":"My Racket","description":"d","price":99,` +
	`"originalPrice":null,"stockQuantity":1,"location":"Kuala Lumpur","weightCategory":"4U",` +
	`"flexibilityCategory":"Medium Flex","balanceCategory":"Even Balance","status":"active"}`

func newUpdateRequest(t *testing.T, body string) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	e := echo.New()
	request := httptest.NewRequest(http.MethodPut, "/products/60", bytes.NewBufferString(body))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	c := e.NewContext(request, recorder)
	c.SetParamNames("id")
	c.SetParamValues("60")
	c.Set("userId", 42)
	return c, recorder
}

// The whole point of splitting the handlers: the edit form's body must be
// accepted, and every field on it must reach the UPDATE. The WithArgs list is
// the assertion — condition, dealing_method, phone_number and original_price are
// all present, and they were silently dropped before.
func TestUpdateProductWritesEveryFieldTheEditFormSends(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(60).WillReturnRows(currentListingRow())
	// updateListingColumns takes a map, and GORM emits map keys in ALPHABETICAL
	// order with the table name quoted — hence the loose matcher and this arg
	// ordering rather than the one written in the SQL above. updated_at is
	// inlined as CURRENT_TIMESTAMP by gorm.Expr, so it binds no argument.
	mock.ExpectExec(`UPDATE ["']?listings["']?`).
		WithArgs(
			"Even Balance", // balance_category
			"Rackets",      // category
			"New",          // condition
			"Meet Up",      // dealing_method
			"d",            // description
			"Medium Flex",  // flexibility_category
			"Kuala Lumpur", // location
			nil,            // original_price
			"0123456789",   // phone_number
			99.0,           // price
			"active",       // status
			1,              // stock_quantity
			"My Racket",    // title
			"4U",           // weight_category
			60,             // WHERE id
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT").WillReturnRows(updatedListingRow())

	c, recorder := newUpdateRequest(t, editFormBody)
	expectHandled(t, updateProduct(c, gormDB))
	if recorder.Code != 200 {
		t.Fatalf("status = %d, want 200; body = %s", recorder.Code, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("update did not write the expected columns: %v", err)
	}
}

// A seller owns only the active/archived pair. 'sold' belongs to the order flow,
// so asking for it by hand is refused outright rather than quietly ignored —
// silently dropping it would leave My Shop reporting a change that never landed.
func TestUpdateProductRejectsOrderFlowStatus(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(60).WillReturnRows(currentListingRow())
	// No ExpectExec: sqlmock fails the test if an update is attempted.

	body := `{"category":"Rackets","condition":"New","dealingMethod":"Meet Up",` +
		`"phoneNumber":"0123456789","title":"My Racket","description":"d","price":99,` +
		`"originalPrice":null,"stockQuantity":1,"location":"Kuala Lumpur","weightCategory":"4U",` +
		`"flexibilityCategory":"Medium Flex","balanceCategory":"Even Balance","status":"sold"}`

	c, recorder := newUpdateRequest(t, body)
	expectHandled(t, updateProduct(c, gormDB))
	if recorder.Code != 400 {
		t.Fatalf("status = %d, want 400; body = %s", recorder.Code, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a rejected status still reached the database: %v", err)
	}
}

// My Shop's Archive button is an ordinary edit carrying status=archived. It has
// to actually move the listing — the whole reason this is settable at all.
func TestUpdateProductArchivesWhenAsked(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(60).WillReturnRows(currentListingRow()) // stored status: active
	mock.ExpectExec(`UPDATE ["']?listings["']?`).
		WithArgs(
			"Even Balance", "Rackets", "New", "Meet Up", "d", "Medium Flex",
			"Kuala Lumpur", nil, "0123456789", 99.0,
			"archived", // <- the requested status is honoured
			1, "My Racket", "4U", 60,
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT").WillReturnRows(updatedListingRow())

	body := `{"category":"Rackets","condition":"New","dealingMethod":"Meet Up",` +
		`"phoneNumber":"0123456789","title":"My Racket","description":"d","price":99,` +
		`"originalPrice":null,"stockQuantity":1,"location":"Kuala Lumpur","weightCategory":"4U",` +
		`"flexibilityCategory":"Medium Flex","balanceCategory":"Even Balance","status":"archived"}`

	c, _ := newUpdateRequest(t, body)
	expectHandled(t, updateProduct(c, gormDB))
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("archive did not reach the database: %v", err)
	}
}

// The API-key surface keeps its narrow contract: a field it does not patch is a
// clean 400 and, critically, NO update runs. sqlmock fails the test if an Exec
// it was not told to expect is attempted, which is what proves the handler
// aborted rather than carrying on as it used to.
func TestUpdateProductForAPIKeyRejectsUnknownFieldWithoutWriting(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT seller_id, title, description, price, location").
		WithArgs(60).WillReturnRows(currentListingRow())

	c, recorder := newUpdateRequest(t, `{"title":"X","condition":"New"}`)
	err := updateProductForAPIKey(c, gormDB)

	if err != errResponseWritten {
		t.Fatalf("handler returned %v, want errResponseWritten so the caller aborts", err)
	}
	if recorder.Code != 400 {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	// One JSON document, not two concatenated ones — this is the bug that made
	// the browser fall back to a generic message.
	if body := recorder.Body.String(); body != "{\"error\":\"invalid field: condition\"}\n" {
		t.Fatalf("body = %q, want a single parseable JSON object naming the field", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations unmet: %v", err)
	}
}

// bindStrictJSON must never report success after writing an error response.
// Returning c.JSON's value did exactly that, because c.JSON returns nil once it
// has written, so `if err != nil` never fired.
func TestBindStrictJSONReturnsNonNilAfterWritingError(t *testing.T) {
	e := echo.New()
	request := httptest.NewRequest(http.MethodPut, "/x", bytes.NewBufferString(`{"nope":1}`))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	c := e.NewContext(request, recorder)

	var dest UpdateProductRequest
	if err := bindStrictJSON(c, &dest); err == nil {
		t.Fatal("bindStrictJSON returned nil after rejecting the body; callers will run on")
	}
	if recorder.Code != 400 {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}
