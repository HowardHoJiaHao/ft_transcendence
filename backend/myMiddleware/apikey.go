package myMiddleware

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// HashAPIKey returns the hex SHA-256 of a plaintext API key. The plaintext is
// never stored — only this hash goes in api_keys.key_hash, and every incoming
// request is re-hashed and matched against it.
func HashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// Fixed-window rate limiter, per API key, kept in memory. Resets on backend
// restart and is per-instance — fine for a single-replica deployment.
type rateWindow struct {
	windowStart time.Time
	count       int
}

var (
	rateMu      sync.Mutex
	rateWindows = map[int]*rateWindow{}
)

func allowRequest(keyID, limitPerMinute int) bool {
	rateMu.Lock()
	defer rateMu.Unlock()
	now := time.Now()
	w, ok := rateWindows[keyID]
	if !ok || now.Sub(w.windowStart) >= time.Minute {
		rateWindows[keyID] = &rateWindow{windowStart: now, count: 1}
		return true
	}
	if w.count >= limitPerMinute {
		return false
	}
	w.count++
	return true
}

// APIKeyAuth authenticates requests via the X-API-Key header, enforces the
// key's per-minute rate limit, and records every call to api_request_logs.
func APIKeyAuth(db *sql.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			key := c.Request().Header.Get("X-API-Key")
			if key == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Missing X-API-Key header"})
			}

			var keyID, userID, rateLimit int
			var isActive bool
			err := db.QueryRow(
				"SELECT id, user_id, rate_limit, is_active FROM api_keys WHERE key_hash = $1",
				HashAPIKey(key),
			).Scan(&keyID, &userID, &rateLimit, &isActive)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid API key"})
			}
			if !isActive {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "API key has been revoked"})
			}
			if !allowRequest(keyID, rateLimit) {
				return c.JSON(http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
			}

			c.Set("userId", userID)
			c.Set("apiKeyId", keyID)

			_, _ = db.Exec("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", keyID)

			handlerErr := next(c)

			status := c.Response().Status
			if he, ok := handlerErr.(*echo.HTTPError); ok {
				status = he.Code
			}
			_, _ = db.Exec(
				`INSERT INTO api_request_logs (api_key_id, user_id, method, path, status, ip_address)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				keyID, userID, c.Request().Method, c.Request().URL.Path, status, c.RealIP(),
			)

			return handlerErr
		}
	}
}
