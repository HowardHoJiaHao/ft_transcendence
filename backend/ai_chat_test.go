package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	auth "transcendence/modules/user/auth"
)

const aiChatTestJWTSecret = "ai-chat-test-secret-at-least-32-characters"

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func captureAIRequestClient(t *testing.T, received *AIChatRequest) {
	t.Helper()

	previous := aiHTTPClient
	t.Cleanup(func() {
		aiHTTPClient = previous
	})
	aiHTTPClient = &http.Client{
		Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if err := json.NewDecoder(request.Body).Decode(received); err != nil {
				t.Fatalf("decode downstream request: %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader("data: [DONE]\n\n")),
				Request:    request,
			}, nil
		}),
	}
}

func TestAIChatIgnoresUntrustedIdentityFieldsFromRequestBody(t *testing.T) {
	var received AIChatRequest
	captureAIRequestClient(t, &received)
	t.Setenv("AI_SERVICE_URL", "http://ai.test")

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/ai/chat",
		bytes.NewBufferString(`{
			"message":"hello",
			"userId":999,
			"authToken":"attacker-supplied-token"
		}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)

	if err := handleAIChat(context); err != nil {
		t.Fatalf("handleAIChat() error = %v", err)
	}
	if received.UserID != 0 || received.AuthToken != "" {
		t.Fatalf("untrusted identity was forwarded: userId=%d token=%q", received.UserID, received.AuthToken)
	}
}

func TestAIChatForwardsOnlyValidatedJWTIdentity(t *testing.T) {
	t.Setenv("JWT_SECRET", aiChatTestJWTSecret)
	if err := auth.ConfigureJWTSecretFromEnv(); err != nil {
		t.Fatalf("ConfigureJWTSecretFromEnv() error = %v", err)
	}
	token, err := auth.GenerateToken(42)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	var received AIChatRequest
	captureAIRequestClient(t, &received)
	t.Setenv("AI_SERVICE_URL", "http://ai.test")

	e := echo.New()
	request := httptest.NewRequest(
		http.MethodPost,
		"/ai/chat",
		bytes.NewBufferString(`{"message":"hello","userId":999,"authToken":"attacker"}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)

	if err := handleAIChat(context); err != nil {
		t.Fatalf("handleAIChat() error = %v", err)
	}
	if received.UserID != 42 || received.AuthToken != token {
		t.Fatalf("forwarded identity = userId=%d token=%q", received.UserID, received.AuthToken)
	}
}
