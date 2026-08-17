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

// APIKeyLifetime is how long a new key stays valid. A leaked key stops working
// on its own rather than living until somebody notices.
const APIKeyLifetime = 30 * 24 * time.Hour

// Outcomes recorded against every request. The rejected ones are the point:
// they are what turns the log into something an attack shows up in.
const (
	outcomeSuccess     = "success"
	outcomeMissingKey  = "missing_key"
	outcomeInvalidKey  = "invalid_key"
	outcomeRevokedKey  = "revoked_key"
	outcomeExpiredKey  = "expired_key"
	outcomeRateLimited = "rate_limited"
)

const maxUserAgentLen = 255

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

// attempt is what one request looked like, whether or not it was allowed.
type attempt struct {
	keyID       *int
	userID      *int
	status      int
	outcome     string
	fingerprint *string
}

// recordAttempt writes one row to api_request_logs. Every path through the
// middleware ends here, including the rejections, so a key that is guessed,
// revoked, expired or hammered leaves the same trail a successful call does.
//
// Best-effort by design: a failed insert must never turn into a failed request.
func recordAttempt(db *sql.DB, c echo.Context, a attempt) {
	userAgent := c.Request().UserAgent()
	if len(userAgent) > maxUserAgentLen {
		userAgent = userAgent[:maxUserAgentLen]
	}
	_, _ = db.Exec(
		`INSERT INTO api_request_logs
		   (api_key_id, user_id, method, path, status, ip_address,
		    outcome, user_agent, key_fingerprint)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		a.keyID, a.userID, c.Request().Method, c.Request().URL.Path,
		a.status, c.RealIP(), a.outcome, userAgent, a.fingerprint,
	)
}

// fingerprint is the first 12 hex characters of a key's SHA-256. It is enough
// to correlate repeated attempts with the same key without storing anything
// that could be replayed — the hash is one-way, and this is only part of it.
func fingerprint(hash string) *string {
	if len(hash) < 12 {
		return nil
	}
	short := hash[:12]
	return &short
}

// APIKeyAuth authenticates requests via the X-API-Key header, enforces the
// key's expiry and per-minute rate limit, and records EVERY call to
// api_request_logs — accepted or rejected.
//
// ─── WHAT THIS MIDDLEWARE DOES, IN ORDER ──────────────────────────────────────
//
//  1. read X-API-Key         missing        → 401  logged missing_key
//  2. hash it and look it up unknown        → 401  logged invalid_key
//  3. check it is active     revoked        → 403  logged revoked_key
//  4. check it has not expired              → 401  logged expired_key
//  5. check the rate limit   over limit     → 429  logged rate_limited
//  6. publish the identity   c.Set("userId", ...)
//  7. touch last_used_at     (for the key-management UI)
//  8. run the handler
//  9. log the call           logged success (or the handler's own status)
//
// ─── WHY THE REJECTIONS ARE LOGGED ────────────────────────────────────────────
//
// A log of only the calls that worked cannot show an attack. Someone guessing
// keys never reaches step 6, so under the previous version they left no trace
// at all. Recording the rejections is what makes "one address, four hundred
// invalid_key in a minute" a thing you can see.
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
				recordAttempt(db, c, attempt{
					status:  http.StatusUnauthorized,
					outcome: outcomeMissingKey,
				})
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Missing X-API-Key header"})
			}

			// 2. Look the key up BY ITS HASH. The plaintext is never compared
			// against anything stored, because nothing stored is plaintext.
			// The key's own rate_limit and expiry are fetched here too.
			hash := HashAPIKey(key)
			var keyID, userID, rateLimit int
			var isActive bool
			var expiresAt sql.NullTime
			err := db.QueryRow(
				"SELECT id, user_id, rate_limit, is_active, expires_at FROM api_keys WHERE key_hash = $1",
				hash,
			).Scan(&keyID, &userID, &rateLimit, &isActive, &expiresAt)
			if err != nil {
				// Unknown key: nothing to attribute it to, so the row carries
				// only the address, the agent and the fingerprint.
				recordAttempt(db, c, attempt{
					status:      http.StatusUnauthorized,
					outcome:     outcomeInvalidKey,
					fingerprint: fingerprint(hash),
				})
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid API key"})
			}

			// 3. Revoked keys stay in the table but it is just no longer allowed.
			if !isActive {
				recordAttempt(db, c, attempt{
					keyID: &keyID, userID: &userID,
					status:      http.StatusForbidden,
					outcome:     outcomeRevokedKey,
					fingerprint: fingerprint(hash),
				})
				return c.JSON(http.StatusForbidden, map[string]string{"error": "API key has been revoked"})
			}

			// 4. Expiry. Checked against the database value on every request, so
			// shortening a key's life takes effect immediately.
			if expiresAt.Valid && !time.Now().Before(expiresAt.Time) {
				recordAttempt(db, c, attempt{
					keyID: &keyID, userID: &userID,
					status:      http.StatusUnauthorized,
					outcome:     outcomeExpiredKey,
					fingerprint: fingerprint(hash),
				})
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "API key has expired. Create a new one from the Developer API page.",
				})
			}

			// 5. Rate limit, checked
			if !allowRequest(keyID, rateLimit) {
				recordAttempt(db, c, attempt{
					keyID: &keyID, userID: &userID,
					status:      http.StatusTooManyRequests,
					outcome:     outcomeRateLimited,
					fingerprint: fingerprint(hash),
				})
				return c.JSON(http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded"})
			}

			// 6. Publish the identity for downstream handlers.
			c.Set("userId", userID)
			c.Set("apiKeyId", keyID)

			// 7. Best-effort "last used" stamp powering the key-management UI.
			_, _ = db.Exec("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", keyID)

			// 8. Run the actual handler. Its error is held, not returned yet,
			// so the request can still be logged below.
			handlerErr := next(c)

			// 9. Log the call. The status normally comes off the response, but
			// when a handler returns an *echo.HTTPError the response may not
			// have been written yet — so the error's own code is preferred,
			// otherwise failures would all be recorded as 200.
			status := c.Response().Status
			if he, ok := handlerErr.(*echo.HTTPError); ok {
				status = he.Code
			}
			recordAttempt(db, c, attempt{
				keyID: &keyID, userID: &userID,
				status:      status,
				outcome:     outcomeSuccess,
				fingerprint: fingerprint(hash),
			})

			// Return the handler's result untouched — logging observes, never
			// alters, the outcome.
			return handlerErr
		}
	}
}
