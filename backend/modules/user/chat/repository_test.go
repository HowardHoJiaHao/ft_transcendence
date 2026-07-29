package chat

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"transcendence/modules/user"
)

func TestSearchDirectoryUsersReturnsLimitedDirectoryFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	repo := NewRepository(&user.Repository{DB: db})
	rows := sqlmock.NewRows([]string{"id", "username", "avatar_url", "is_seller", "is_buyer"}).
		AddRow(8, "Alice", sql.NullString{String: "/avatar/alice.png", Valid: true}, true, false)
	mock.ExpectQuery("SELECT u.id, u.username, u.avatar_url").
		WithArgs(7, "%ali%", 10, 0).
		WillReturnRows(rows)

	people, err := repo.SearchDirectoryUsers(7, " ali ", "seller", 10, 0)
	if err != nil {
		t.Fatalf("SearchDirectoryUsers() error = %v", err)
	}
	if len(people) != 1 {
		t.Fatalf("len(people) = %d, want 1", len(people))
	}
	if people[0].ID != 8 || people[0].Username != "Alice" || people[0].AvatarURL == nil || *people[0].AvatarURL != "/avatar/alice.png" || !people[0].IsSeller || people[0].IsBuyer {
		t.Fatalf("unexpected directory user: %+v", people[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
