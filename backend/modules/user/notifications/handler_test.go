package notifications

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestHandlersRejectMissingAuthAndInvalidInputs(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		target     string
		body       string
		userID     interface{}
		call       func(*Handler, echo.Context) error
		wantStatus int
	}{
		{
			name: "list requires auth", method: http.MethodGet, target: "/notifications",
			call: (*Handler).List, wantStatus: http.StatusUnauthorized,
		},
		{
			name: "list rejects large limit", method: http.MethodGet, target: "/notifications?limit=101",
			userID: 7, call: (*Handler).List, wantStatus: http.StatusBadRequest,
		},
		{
			name: "mark read requires auth", method: http.MethodPatch, target: "/notifications/read",
			body: `{"ids":[1]}`, call: (*Handler).MarkRead, wantStatus: http.StatusUnauthorized,
		},
		{
			name: "mark read rejects empty ids", method: http.MethodPatch, target: "/notifications/read",
			body: `{"ids":[]}`, userID: 7, call: (*Handler).MarkRead, wantStatus: http.StatusBadRequest,
		},
		{
			name: "mark read rejects duplicate ids", method: http.MethodPatch, target: "/notifications/read",
			body: `{"ids":[1,1]}`, userID: 7, call: (*Handler).MarkRead, wantStatus: http.StatusBadRequest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			request := httptest.NewRequest(test.method, test.target, bytes.NewBufferString(test.body))
			request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			if test.userID != nil {
				context.Set("userId", test.userID)
			}

			if err := test.call(&Handler{}, context); err != nil {
				t.Fatalf("handler error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
		})
	}
}
