package friends

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"transcendence/modules/user"
	"transcendence/modules/user/notifications"
)

func TestAddFriendCreatesRecipientNotificationOnlyOnce(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	repo := NewRepository(&user.Repository{DB: db})
	notificationRepo := notifications.NewRepository(db)

	mock.ExpectQuery("SELECT id FROM users").
		WithArgs(9).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO friendships").
		WithArgs(4, 9).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(20))
	mock.ExpectQuery("INSERT INTO friendships").
		WithArgs(9, 4).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(21))
	mock.ExpectQuery("INSERT INTO notifications").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(200))
	mock.ExpectCommit()

	notificationID, err := repo.AddFriendWithNotification(4, 9, notificationRepo)
	if err != nil {
		t.Fatalf("AddFriendWithNotification() error = %v", err)
	}
	if notificationID != 200 {
		t.Fatalf("notification id = %d, want 200", notificationID)
	}

	mock.ExpectQuery("SELECT id FROM users").
		WithArgs(9).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(9))
	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO friendships").
		WithArgs(4, 9).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("INSERT INTO friendships").
		WithArgs(9, 4).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectCommit()

	duplicateID, err := repo.AddFriendWithNotification(4, 9, notificationRepo)
	if err != nil {
		t.Fatalf("duplicate AddFriendWithNotification() error = %v", err)
	}
	if duplicateID != 0 {
		t.Fatalf("duplicate notification id = %d, want 0", duplicateID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}

}
