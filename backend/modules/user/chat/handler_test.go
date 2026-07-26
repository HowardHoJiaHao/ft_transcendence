package chat

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestSendMessageRejectsUnauthenticatedInvalidAndSelfDirectedMessages(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		userID     any
		wantStatus int
	}{
		{
			name:       "unauthenticated",
			body:       `{"receiver_id":7,"content":"hello"}`,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing receiver",
			body:       `{"content":"hello"}`,
			userID:     42,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty content",
			body:       `{"receiver_id":7,"content":""}`,
			userID:     42,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "self message",
			body:       `{"receiver_id":42,"content":"hello"}`,
			userID:     42,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			request := httptest.NewRequest(http.MethodPost, "/messages", bytes.NewBufferString(test.body))
			request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)
			if test.userID != nil {
				context.Set("userId", test.userID)
			}

			if err := (&Handler{}).SendMessage(context); err != nil {
				t.Fatalf("SendMessage() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
		})
	}
}

func TestWebSocketRejectsMissingAndInvalidTokensBeforeUpgrade(t *testing.T) {
	tests := []struct {
		name       string
		target     string
		wantStatus int
	}{
		{name: "missing token", target: "/ws", wantStatus: http.StatusBadRequest},
		{name: "invalid token", target: "/ws?token=invalid", wantStatus: http.StatusUnauthorized},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)

			if err := (&Handler{}).WebSocketHandler(context); err != nil {
				t.Fatalf("WebSocketHandler() error = %v", err)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
		})
	}
}
