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

// HashAPIKey returns the hex SHA-256 of a plaintext API key.
func HashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// Fixed-window rate limiter, per API key, kept in memory.
type rateWindow struct {
	windowStart time.Time
	count       int
}

var (
	// One mutex guarding the whole map: Echo serves each request on its own
	// goroutine, so without it concurrent calls using the same key would race
	// on the counter and the limit could be exceeded.
	rateMu      sync.Mutex
	rateWindows = map[int]*rateWindow{} // keyed by api_keys.id
)

// allowRequest records one request against a key's window and reports whether
// it may proceed. Returns false only when the key is over its limit.
func allowRequest(keyID, limitPerMinute int) bool {
	rateMu.Lock()
	defer rateMu.Unlock()

	now := time.Now()
	w, ok := rateWindows[keyID]

	// No window yet, or the previous one has aged out: start a fresh minute.
	if !ok || now.Sub(w.windowStart) >= time.Minute {
		rateWindows[keyID] = &rateWindow{windowStart: now, count: 1}
		return true
	}

	// At the limit — refuse without incrementing
	if w.count >= limitPerMinute {
		return false
	}

	w.count++
	return true
}

// APIKeyAuth authenticates requests via the X-API-Key header, enforces the
// key's per-minute rate limit, and records every call to api_request_logs.
//
// ─── WHAT THIS MIDDLEWARE DOES, IN ORDER ──────────────────────────────────────
//
//  1. read X-API-Key         missing        → 401
//  2. hash it and look it up unknown        → 401
//  3. check it is active     revoked        → 403
//  4. check the rate limit   over limit     → 429
//  5. publish the identity   c.Set("userId", ...)
//  6. touch last_used_at     (for the key-management UI)
//  7. run the handler
//  8. log the call           method, path, status, IP
//
// ─── WHY LOGGING HAPPENS AFTER next(c) ────────────────────────────────────────
//
// The response status is only known once the handler has run, so the log write
// is deliberately placed after it. The handler's error is captured, recorded,
// and then returned unchanged, so logging never swallows a failure.
func APIKeyAuth(db *sql.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// 1. The credential travels in a header, never a query string —
			// URLs end up in browser history, proxy logs and Referer headers.
			key := c.Request().Header.Get("X-API-Key")
			if key == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Missing X-API-Key header"})
			}

			// 2. Look the key up BY ITS HASH. The plaintext is never compared
			// against anything stored, because nothing stored is plaintext.
			// The key's own rate_limit is fetched here too, so limits are
			// per-key rather than one global setting.
			var keyID, userID, rateLimit int
			var isActive bool
			err := db.QueryRow(
				"SELECT id, user_id, rate_limit, is_active FROM api_keys WHERE key_hash = $1",
				HashAPIKey(key),
			).Scan(&keyID, &userID, &rateLimit, &isActive)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid API key"})
			}

			// 3. Revoked keys stay in the table but it is just no longer allowed.
			if !isActive {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "API key has been revoked"})
			}

			// 4. Rate limit, checked
			if !allowRequest(keyID, rateLimit) {
				return c.JSON(http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
			}

			// 5. Publish the identity for downstream handlers.
			c.Set("userId", userID)
			c.Set("apiKeyId", keyID)

			// 6. Best-effort "last used" stamp powering the key-management UI.
			_, _ = db.Exec("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", keyID)

			// 7. Run the actual handler. Its error is held, not returned yet,
			// so the request can still be logged below.
			// execute the api only come back
			handlerErr := next(c)

			// 8. Log the call. The status normally comes off the response, but
			// when a handler returns an *echo.HTTPError the response may not
			// have been written yet — so the error's own code is preferred,
			// otherwise failures would all be recorded as 200.
			status := c.Response().Status
			if he, ok := handlerErr.(*echo.HTTPError); ok {
				status = he.Code
			}
			// Every call is recorded — this is what the developer-api page
			// renders as the request log. RealIP() reads the proxy headers, so
			// the client's address survives the WAF → nginx → backend hops
			// instead of logging the proxy's own IP every time.
			_, _ = db.Exec(
				`INSERT INTO api_request_logs (api_key_id, user_id, method, path, status, ip_address)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				keyID, userID, c.Request().Method, c.Request().URL.Path, status, c.RealIP(),
			)

			// Return the handler's result untouched — logging observes, never
			// alters, the outcome.
			return handlerErr
		}
	}
}
