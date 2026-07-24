package myMiddleware

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	auth "transcendence/modules/user/auth"
)

const middlewareTestJWTSecret = "middleware-test-secret-at-least-32-characters"

func configureTestJWT(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", middlewareTestJWTSecret)
	if err := auth.ConfigureJWTSecretFromEnv(); err != nil {
		t.Fatalf("ConfigureJWTSecretFromEnv() error = %v", err)
	}
}

func newMockDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	t.Cleanup(func() {
		db.Close()
	})
	return db, mock
}

func TestHashAPIKeyIsDeterministicAndDoesNotExposePlaintext(t *testing.T) {
	key := "sk_live_highly-sensitive-value"
	first := HashAPIKey(key)
	second := HashAPIKey(key)

	if first != second {
		t.Fatal("same API key produced different hashes")
	}
	if first == key || len(first) != 64 {
		t.Fatalf("HashAPIKey() returned unsafe value %q", first)
	}
	if first == HashAPIKey(key+"changed") {
		t.Fatal("different API keys produced the same hash")
	}
}

func TestRateLimiterIsPerKeyAndEnforcesLimit(t *testing.T) {
	rateMu.Lock()
	rateWindows = map[int]*rateWindow{}
	rateMu.Unlock()

	if !allowRequest(10, 1) {
		t.Fatal("first request should be allowed")
	}
	if allowRequest(10, 1) {
		t.Fatal("second request above the limit should be rejected")
	}
	if !allowRequest(11, 1) {
		t.Fatal("one API key exhausted another API key's allowance")
	}
}

func TestJWTAuthRejectsMissingInvalidAndAdminTokens(t *testing.T) {
	configureTestJWT(t)
	db, _ := newMockDB(t)

	adminToken, err := auth.GenerateAdminToken()
	if err != nil {
		t.Fatalf("GenerateAdminToken() error = %v", err)
	}

	tests := []struct {
		name       string
		header     string
		wantStatus int
	}{
		{name: "missing token", wantStatus: http.StatusUnauthorized},
		{name: "invalid token", header: "Bearer invalid", wantStatus: http.StatusUnauthorized},
		{name: "admin cannot use member route", header: "Bearer " + adminToken, wantStatus: http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			request := httptest.NewRequest(http.MethodGet, "/protected", nil)
			request.Header.Set(echo.HeaderAuthorization, test.header)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)

			called := false
			handler := JWTAuth(db)(func(c echo.Context) error {
				called = true
				return c.NoContent(http.StatusNoContent)
			})
			if err := handler(context); err != nil {
				t.Fatalf("handler error = %v", err)
			}
			if called {
				t.Fatal("protected handler was called")
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
		})
	}
}

func TestJWTAuthAllowsOnlyActiveExistingMember(t *testing.T) {
	configureTestJWT(t)

	token, err := auth.GenerateToken(42)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	query := regexp.QuoteMeta("SELECT account_status FROM users WHERE id = $1")

	t.Run("active member", func(t *testing.T) {
		db, mock := newMockDB(t)
		mock.ExpectQuery(query).
			WithArgs(42).
			WillReturnRows(sqlmock.NewRows([]string{"account_status"}).AddRow("active"))

		e := echo.New()
		request := httptest.NewRequest(http.MethodGet, "/protected", nil)
		request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
		recorder := httptest.NewRecorder()
		context := e.NewContext(request, recorder)

		handler := JWTAuth(db)(func(c echo.Context) error {
			if got := c.Get("userId"); got != 42 {
				t.Fatalf("trusted userId = %v, want 42", got)
			}
			return c.NoContent(http.StatusNoContent)
		})
		if err := handler(context); err != nil {
			t.Fatalf("handler error = %v", err)
		}
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("suspended member", func(t *testing.T) {
		db, mock := newMockDB(t)
		mock.ExpectQuery(query).
			WithArgs(42).
			WillReturnRows(sqlmock.NewRows([]string{"account_status"}).AddRow("suspended"))

		e := echo.New()
		request := httptest.NewRequest(http.MethodGet, "/protected", nil)
		request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
		recorder := httptest.NewRecorder()
		context := e.NewContext(request, recorder)

		called := false
		handler := JWTAuth(db)(func(c echo.Context) error {
			called = true
			return nil
		})
		if err := handler(context); err != nil {
			t.Fatalf("handler error = %v", err)
		}
		if called || recorder.Code != http.StatusForbidden {
			t.Fatalf("called = %v, status = %d; want blocked with 403", called, recorder.Code)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("deleted member", func(t *testing.T) {
		db, mock := newMockDB(t)
		mock.ExpectQuery(query).
			WithArgs(42).
			WillReturnError(sql.ErrNoRows)

		e := echo.New()
		request := httptest.NewRequest(http.MethodGet, "/protected", nil)
		request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
		recorder := httptest.NewRecorder()
		context := e.NewContext(request, recorder)

		handler := JWTAuth(db)(func(c echo.Context) error {
			t.Fatal("deleted user reached protected handler")
			return nil
		})
		if err := handler(context); err != nil {
			t.Fatalf("handler error = %v", err)
		}
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestAdminAuthEnforcesRoleSeparation(t *testing.T) {
	configureTestJWT(t)

	memberToken, err := auth.GenerateToken(42)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	adminToken, err := auth.GenerateAdminToken()
	if err != nil {
		t.Fatalf("GenerateAdminToken() error = %v", err)
	}

	tests := []struct {
		name       string
		header     string
		wantStatus int
		wantCalled bool
	}{
		{name: "missing", wantStatus: http.StatusUnauthorized},
		{name: "member forbidden", header: "Bearer " + memberToken, wantStatus: http.StatusForbidden},
		{name: "admin allowed", header: "Bearer " + adminToken, wantStatus: http.StatusNoContent, wantCalled: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			request := httptest.NewRequest(http.MethodGet, "/admin", nil)
			request.Header.Set(echo.HeaderAuthorization, test.header)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)

			called := false
			handler := AdminAuth()(func(c echo.Context) error {
				called = true
				return c.NoContent(http.StatusNoContent)
			})
			if err := handler(context); err != nil {
				t.Fatalf("handler error = %v", err)
			}
			if called != test.wantCalled {
				t.Fatalf("handler called = %v, want %v", called, test.wantCalled)
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
		})
	}
}

func TestAPIKeyAuthRejectsMissingUnknownAndRevokedKeys(t *testing.T) {
	tests := []struct {
		name       string
		key        string
		prepare    func(sqlmock.Sqlmock)
		wantStatus int
	}{
		{
			name:       "missing key",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "unknown key",
			key:  "unknown",
			prepare: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT id, user_id, rate_limit, is_active FROM api_keys").
					WithArgs(HashAPIKey("unknown")).
					WillReturnError(sql.ErrNoRows)
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "revoked key",
			key:  "revoked",
			prepare: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT id, user_id, rate_limit, is_active FROM api_keys").
					WithArgs(HashAPIKey("revoked")).
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "rate_limit", "is_active"}).
						AddRow(5, 42, 100, false))
			},
			wantStatus: http.StatusForbidden,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, mock := newMockDB(t)
			if test.prepare != nil {
				test.prepare(mock)
			}

			e := echo.New()
			request := httptest.NewRequest(http.MethodGet, "/api/public/v1/products", nil)
			request.Header.Set("X-API-Key", test.key)
			recorder := httptest.NewRecorder()
			context := e.NewContext(request, recorder)

			called := false
			handler := APIKeyAuth(db)(func(c echo.Context) error {
				called = true
				return nil
			})
			if err := handler(context); err != nil {
				t.Fatalf("handler error = %v", err)
			}
			if called {
				t.Fatal("protected API handler was called")
			}
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAPIKeyAuthSetsTrustedIdentityAndWritesAuditLog(t *testing.T) {
	rateMu.Lock()
	rateWindows = map[int]*rateWindow{}
	rateMu.Unlock()

	db, mock := newMockDB(t)
	key := "sk_live_valid"
	mock.ExpectQuery("SELECT id, user_id, rate_limit, is_active FROM api_keys").
		WithArgs(HashAPIKey(key)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "rate_limit", "is_active"}).
			AddRow(11, 42, 100, true))
	mock.ExpectExec("UPDATE api_keys SET last_used_at").
		WithArgs(11).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO api_request_logs").
		WithArgs(11, 42, http.MethodGet, "/api/public/v1/products", http.StatusOK, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	e := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/api/public/v1/products", nil)
	request.Header.Set("X-API-Key", key)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)

	handler := APIKeyAuth(db)(func(c echo.Context) error {
		if c.Get("userId") != 42 || c.Get("apiKeyId") != 11 {
			t.Fatalf("trusted context = user %v, key %v", c.Get("userId"), c.Get("apiKeyId"))
		}
		return c.JSON(http.StatusOK, map[string]bool{"ok": true})
	})
	if err := handler(context); err != nil {
		t.Fatalf("handler error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAPIKeyAuthAuditsHandlerErrorsWithTheirHTTPStatus(t *testing.T) {
	rateMu.Lock()
	rateWindows = map[int]*rateWindow{}
	rateMu.Unlock()

	db, mock := newMockDB(t)
	key := "sk_live_error"
	mock.ExpectQuery("SELECT id, user_id, rate_limit, is_active FROM api_keys").
		WithArgs(HashAPIKey(key)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "rate_limit", "is_active"}).
			AddRow(12, 42, 100, true))
	mock.ExpectExec("UPDATE api_keys SET last_used_at").
		WithArgs(12).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO api_request_logs").
		WithArgs(12, 42, http.MethodPost, "/api/public/v1/products", http.StatusUnprocessableEntity, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	e := echo.New()
	request := httptest.NewRequest(http.MethodPost, "/api/public/v1/products", nil)
	request.Header.Set("X-API-Key", key)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)

	handler := APIKeyAuth(db)(func(c echo.Context) error {
		return echo.NewHTTPError(http.StatusUnprocessableEntity, "invalid listing")
	})
	err := handler(context)
	httpError, ok := err.(*echo.HTTPError)
	if !ok || httpError.Code != http.StatusUnprocessableEntity {
		t.Fatalf("handler error = %v, want HTTP 422", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
