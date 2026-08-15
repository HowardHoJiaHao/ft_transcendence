package main

import (
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// expectHandled fails on a genuine handler error but tolerates
// errResponseWritten.
//
// Handlers return that sentinel once they have already written their own error
// response — a rejected body, a 403, a 404 — so it is a normal outcome, not a
// failure. Tests that call a handler directly must assert on the recorder's
// status code instead of on the returned error.
func expectHandled(t *testing.T, err error) {
	t.Helper()
	if err != nil && !errors.Is(err, errResponseWritten) {
		t.Fatalf("handler error = %v", err)
	}
}

func newTestGormDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()

	rawDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	t.Cleanup(func() {
		rawDB.Close()
	})

	gormDB, err := gorm.Open(
		postgres.New(postgres.Config{Conn: rawDB}),
		&gorm.Config{DisableAutomaticPing: true},
	)
	if err != nil {
		t.Fatalf("gorm.Open() error = %v", err)
	}
	return gormDB, mock
}

func expectNoOutstandingSQL(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
