package profile

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	"transcendence/modules/user"
)

func TestGetProfileReturnsMemberProfileFieldsWithoutEmail(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{
		"id", "username", "email", "first_name", "last_name", "phone_no", "date_of_birth", "gender", "avatar_url", "avatar_data", "avatar_mime_type", "bio", "requires_2fa", "account_status", "oauth_id", "oauth_provider", "created_at",
	}).AddRow(5, "alice", "alice@example.com", "Alice", "Tan", "+60123456789", time.Date(1995, time.May, 20, 0, 0, 0, 0, time.UTC), "Female", "/avatar/alice.png", nil, nil, "Badminton fan", false, "active", nil, nil, time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	mock.ExpectQuery("SELECT id, username, email").WithArgs(5).WillReturnRows(rows)

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/users/5", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetParamNames("id")
	context.SetParamValues("5")
	handler := &Handler{repo: &user.Repository{DB: db}}

	if err := handler.GetProfile(context); err != nil {
		t.Fatalf("GetProfile() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response["username"] != "alice" || response["firstName"] != "Alice" || response["lastName"] != "Tan" || response["bio"] != "Badminton fan" || response["createdAt"] != "2026-01-01T00:00:00Z" {
		t.Fatalf("unexpected public profile: %#v", response)
	}
	for _, privateField := range []string{"email", "accountStatus", "phoneNo", "gender", "dateOfBirth"} {
		if _, found := response[privateField]; found {
			t.Fatalf("response unexpectedly contains private field %q", privateField)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
