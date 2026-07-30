package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func newAdminDeleteContext(userID string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/"+userID, nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetParamNames("id")
	context.SetParamValues(userID)
	context.Set("userRole", "admin")
	context.Set("adminUserId", 0)
	return context, recorder
}

func TestDeleteAdminUserAnonymizesWithoutDeletingTransactionOwner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT account_status, avatar_url FROM users WHERE id = $1 FOR UPDATE",
	)).WithArgs(42).WillReturnRows(
		sqlmock.NewRows([]string{"account_status", "avatar_url"}).AddRow("active", nil),
	)
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM orders").
		WithArgs(42).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec("UPDATE listings").
		WithArgs(deletedUserDisplayName, 42).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("UPDATE api_keys SET is_active = false").
		WithArgs(42).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM friendships").
		WithArgs(42).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("DELETE FROM notifications WHERE user_id").
		WithArgs(42).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE notifications SET actor_id = NULL").
		WithArgs(42).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE users SET").
		WithArgs("deleted_user_42", "deleted_42@deleted.invalid", "!deleted-account-42", 42).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	context, recorder := newAdminDeleteContext("42")
	if err := deleteAdminUser(context, db); err != nil {
		t.Fatalf("deleteAdminUser() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["displayName"] != deletedUserDisplayName || response["ordersRetained"] != true {
		t.Fatalf("unexpected response: %#v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteAdminUserRejectsUnresolvedOrders(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT account_status, avatar_url FROM users WHERE id = $1 FOR UPDATE",
	)).WithArgs(42).WillReturnRows(
		sqlmock.NewRows([]string{"account_status", "avatar_url"}).AddRow("active", nil),
	)
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM orders").
		WithArgs(42).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectRollback()

	context, recorder := newAdminDeleteContext("42")
	if err := deleteAdminUser(context, db); err != nil {
		t.Fatalf("deleteAdminUser() error = %v", err)
	}
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusConflict, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestModeratorCannotDeleteUser(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	context, recorder := newAdminDeleteContext("42")
	context.Set("userRole", "moderator")
	if err := deleteAdminUser(context, db); err != nil {
		t.Fatalf("deleteAdminUser() error = %v", err)
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
