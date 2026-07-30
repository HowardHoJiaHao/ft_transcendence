package notifications

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func newNotificationTestDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, mock
}

func TestTruncatePreviewUsesRunesAndTrimsWhitespace(t *testing.T) {
	if got := truncatePreview("  hello  ", 120); got != "hello" {
		t.Fatalf("truncatePreview() = %q, want hello", got)
	}
	if got := truncatePreview("球拍很好", 3); got != "球拍很…" {
		t.Fatalf("unicode truncatePreview() = %q", got)
	}
}

func TestUpsertMessageNotificationGroupsUnreadMessages(t *testing.T) {
	db, mock := newNotificationTestDB(t)
	repo := NewRepository(db)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO notifications").
		WithArgs(9, 4, 88, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(101))
	mock.ExpectCommit()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("Begin() error = %v", err)
	}
	id, err := repo.UpsertMessageTx(tx, 9, 4, 88, " latest message ")
	if err != nil {
		t.Fatalf("UpsertMessageTx() error = %v", err)
	}
	if id != 101 {
		t.Fatalf("notification id = %d, want 101", id)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestListReturnsUnreadCountAndCursor(t *testing.T) {
	db, mock := newNotificationTestDB(t)
	repo := NewRepository(db)
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)

	rows := sqlmock.NewRows([]string{
		"id", "notification_type", "resource_id", "data", "read_at",
		"created_at", "updated_at", "actor_id", "username", "avatar_url",
	}).
		AddRow(12, TypeMessage, 80, []byte(`{"count":2,"preview":"hello"}`), nil, now, now, 4, "alex", "/a.png").
		AddRow(11, TypeFriendAdded, 4, []byte(`{"profileUserId":4}`), now, now.Add(-time.Minute), now.Add(-time.Minute), 4, "alex", "/a.png")
	mock.ExpectQuery("SELECT[[:space:]]+n.id").
		WithArgs(9, 2).
		WillReturnRows(rows)
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(9).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	page, err := repo.List(9, 1, "")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(page.Notifications) != 1 || page.Notifications[0].ID != 12 {
		t.Fatalf("unexpected page: %+v", page)
	}
	if page.UnreadCount != 1 || page.NextCursor == nil {
		t.Fatalf("unread/cursor = %d/%v", page.UnreadCount, page.NextCursor)
	}
	if page.Notifications[0].Actor == nil || page.Notifications[0].Actor.Username != "alex" {
		t.Fatalf("actor not populated: %+v", page.Notifications[0].Actor)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestMarkReadScopesUpdatesToRecipient(t *testing.T) {
	db, mock := newNotificationTestDB(t)
	repo := NewRepository(db)

	mock.ExpectExec("UPDATE notifications").
		WithArgs(9, int64(10), int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(9).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))

	count, err := repo.MarkRead(9, []int64{10, 11})
	if err != nil {
		t.Fatalf("MarkRead() error = %v", err)
	}
	if count != 3 {
		t.Fatalf("unread count = %d, want 3", count)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestPublishByIDSendsCompleteWebSocketUpsert(t *testing.T) {
	db, mock := newNotificationTestDB(t)
	repo := NewRepository(db)
	now := time.Now().UTC()
	rows := sqlmock.NewRows([]string{
		"id", "notification_type", "resource_id", "data", "read_at",
		"created_at", "updated_at", "actor_id", "username", "avatar_url",
	}).AddRow(25, TypeOrderNew, 70, []byte(`{"listingTitle":"Racket","quantity":1}`), nil, now, now, 3, "buyer", nil)
	mock.ExpectQuery("SELECT[[:space:]]+n.id").
		WithArgs(8, int64(25)).
		WillReturnRows(rows)
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(8).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(4))

	var sent []byte
	service := NewService(repo)
	service.Publisher = func(userID int, payload []byte) {
		if userID != 8 {
			t.Fatalf("published user = %d, want 8", userID)
		}
		sent = append([]byte(nil), payload...)
	}
	service.PublishByID(8, 25)

	var envelope WebSocketUpsert
	if err := json.Unmarshal(sent, &envelope); err != nil {
		t.Fatalf("published payload is invalid: %v", err)
	}
	if envelope.Type != "notification_upsert" || envelope.UnreadCount != 4 || envelope.Notification.ID != 25 {
		t.Fatalf("unexpected envelope: %+v", envelope)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
