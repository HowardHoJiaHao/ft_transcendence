package chat

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"transcendence/modules/user"
	"transcendence/modules/user/notifications"
)

func TestCreateMessagePersistsGroupedNotificationInSameTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	repo := NewRepository(&user.Repository{DB: db})
	repo.Notifications = notifications.NewRepository(db)
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO messages").
		WithArgs(4, 9, "hello").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "sender_id", "receiver_id", "content", "is_read", "created_at",
		}).AddRow(80, 4, 9, "hello", false, now))
	mock.ExpectQuery("INSERT INTO notifications").
		WithArgs(9, 4, 80, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(101))
	mock.ExpectCommit()

	message, notificationID, err := repo.CreateMessageWithNotification(4, 9, "hello")
	if err != nil {
		t.Fatalf("CreateMessageWithNotification() error = %v", err)
	}
	if message.Id != 80 || notificationID != 101 {
		t.Fatalf("message/notification ids = %d/%d", message.Id, notificationID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}

}

func TestCreateMessageWithNotificationRejectsSelfMessageBeforeDatabaseWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()
	repo := NewRepository(&user.Repository{DB: db})
	repo.Notifications = notifications.NewRepository(db)

	if _, _, err := repo.CreateMessageWithNotification(4, 4, "hello"); err == nil {
		t.Fatal("self message was accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database write: %v", err)
	}
}
