package friends

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestFriendMutationsRejectUnauthenticatedAndInvalidRequests(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		friendID   string
		userID     any
		wantStatus int
		call       func(*Handler, echo.Context) error
	}{
		{
			name:       "add without authentication",
			method:     http.MethodPost,
			friendID:   "7",
			wantStatus: http.StatusUnauthorized,
			call:       (*Handler).AddFriend,
		},
		{
			name:       "add invalid friend id",
			method:     http.MethodPost,
			friendID:   "not-a-number",
			userID:     42,
			wantStatus: http.StatusBadRequest,
			call:       (*Handler).AddFriend,
		},
		{
			name:       "remove without authentication",
			method:     http.MethodDelete,
			friendID:   "7",
			wantStatus: http.StatusUnauthorized,
			call:       (*Handler).RemoveFriend,
		},
		{
			name:       "remove invalid friend id",
			method:     http.MethodDelete,
			friendID:   "not-a-number",
			userID:     42,
			wantStatus: http.StatusBadRequest,
			call:       (*Handler).RemoveFriend,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			request := httptest.NewRequest(test.method, "/friends/"+test.friendID, nil)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			context.SetPath("/friends/:friend_id")
			context.SetParamNames("friend_id")
			context.SetParamValues(test.friendID)
			if test.userID != nil {
				context.Set("userId", test.userID)
			}

			if err := test.call(&Handler{}, context); err != nil {
				t.Fatalf("handler error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
		})
	}
}
