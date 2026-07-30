package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	"transcendence/modules/user/notifications"
)

func newReviewContext(method, target, body string, listingID string, userID int) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/products/:id/reviews")
	context.SetParamNames("id")
	context.SetParamValues(listingID)
	if userID > 0 {
		context.Set("userId", userID)
	}
	return context, recorder
}

func TestCreateListingReviewRejectsUsersWithoutCompletedOrder(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT seller_id, title FROM listings").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"seller_id", "title"}).AddRow(7, "Astrox 99"))
	mock.ExpectQuery("SELECT id FROM orders").
		WithArgs(10, 42).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	context, recorder := newReviewContext(http.MethodPost, "/products/10/reviews", `{"rating":5,"comment":"Excellent racket"}`, "10", 42)
	if err := createListingReview(context, gormDB, nil); err != nil {
		t.Fatalf("createListingReview() error = %v", err)
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusForbidden, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateListingReviewPersistsReviewAndSellerNotificationBeforeCommit(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	sqlDB, err := gormDB.DB()
	if err != nil {
		t.Fatalf("gorm DB() error = %v", err)
	}
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT seller_id, title FROM listings").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"seller_id", "title"}).AddRow(7, "Astrox 99"))
	mock.ExpectQuery("SELECT id FROM orders").
		WithArgs(10, 42).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(80))
	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM listing_reviews").
		WithArgs(10, 42).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("INSERT INTO listing_reviews").
		WithArgs(10, 42, 80, 5, "Excellent racket").
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at"}).AddRow(99, now))
	mock.ExpectQuery("SELECT id, username, avatar_url FROM users").
		WithArgs(42).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "avatar_url"}).AddRow(42, "buyer", nil))
	mock.ExpectQuery("INSERT INTO notifications").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(501))
	mock.ExpectCommit()

	service := notifications.NewService(notifications.NewRepository(sqlDB))
	context, recorder := newReviewContext(http.MethodPost, "/products/10/reviews", `{"rating":5,"comment":"Excellent racket"}`, "10", 42)
	if err := createListingReview(context, gormDB, service); err != nil {
		t.Fatalf("createListingReview() error = %v", err)
	}
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestGetListingReviewsPaginatesAndReturnsAggregate(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM listings").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\), COALESCE\\(AVG\\(rating\\), 0\\)").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"count", "avg"}).AddRow(2, 4.5))
	mock.ExpectQuery("SELECT r.id, r.listing_id, r.rating, r.comment, r.created_at").
		WithArgs(10, 1, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "listing_id", "rating", "comment", "created_at", "id", "username", "avatar_url"}).
			AddRow(1, 10, 5, "Great", now, 42, "buyer", nil))

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/products/10/reviews?limit=1&offset=0", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/products/:id/reviews")
	context.SetParamNames("id")
	context.SetParamValues("10")
	if err := getListingReviews(context, gormDB); err != nil {
		t.Fatalf("getListingReviews() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte(`"averageRating":4.5`)) || !bytes.Contains(recorder.Body.Bytes(), []byte(`"nextOffset":1`)) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}
