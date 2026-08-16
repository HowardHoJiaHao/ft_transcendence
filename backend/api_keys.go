package main

// Developer API keys — issue, list, revoke and audit the credentials that
// authenticate the public /api/public/v1 routes.
//
// All four handlers here sit on the JWT-protected group, so key management is
// browser-authenticated and an API key can never be used to mint another API
// key. The other half of the system — checking an incoming key, rate limiting
// it and logging the call — lives in myMiddleware/apikey.go.
//
//	POST   /api/v1/api-keys       createAPIKey    plaintext returned ONCE
//	GET    /api/v1/api-keys       listAPIKeys     metadata only, oldest first
//	DELETE /api/v1/api-keys/:id   revokeAPIKey    soft delete (is_active=false)
//	GET    /api/v1/api-keys/logs  getAPIKeyLogs   audit trail, newest first
//
// ─── TABLE: api_keys ─────────────────────────────────────────────────────────
//
//	id            SERIAL PRIMARY KEY    assigned by Postgres, never reused. The
//	                                    public handle used in DELETE /:id — safe
//	                                    in a URL in a way the hash would not be.
//	user_id       INT NOT NULL          FK → users(id) ON DELETE CASCADE, so
//	                                    deleting a user removes their keys.
//	key_hash      VARCHAR(255)          SHA-256 hex of the key, always 64 chars.
//	              UNIQUE NOT NULL       The plaintext is stored NOWHERE, which is
//	                                    why a lost key can only be replaced.
//	name          VARCHAR(255)          Display label. Nullable in the schema,
//	                                    but createAPIKey always supplies one
//	                                    (defaulting to "API Key") and the SELECT
//	                                    in listAPIKeys relies on that.
//	is_active     BOOLEAN DEFAULT TRUE  Revocation flag. Rows are never deleted,
//	                                    so their request logs stay attributable.
//	rate_limit    INT DEFAULT 100       Requests per minute, enforced per key.
//	created_at    TIMESTAMP             Defaults to now().
//	last_used_at  TIMESTAMP             NULL until the key's first request —
//	                                    hence sql.NullTime when scanning it.

// ─── TABLE: api_request_logs ─────────────────────────────────────────────────
//
//	id           SERIAL PRIMARY KEY
//	api_key_id   INT           FK → api_keys(id) ON DELETE SET NULL
//	user_id      INT           FK → users(id)    ON DELETE SET NULL
//	method       VARCHAR(10)   GET, POST, PUT, DELETE
//	path         VARCHAR(255)  the URL that was called
//	status       INT           the response code that was returned
//	ip_address   VARCHAR(64)   from c.RealIP(), so the caller's address survives
//	                           the WAF → nginx → backend hops
//	created_at   TIMESTAMP     defaults to now()

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/myMiddleware"
)

// APIKeyInfo is the key as the management UI sees it. Note what is absent:
// there is no field for the key itself. Only the hash is stored.
type APIKeyInfo struct {
	ID         int     `json:"id"`
	Name       string  `json:"name"`
	IsActive   bool    `json:"isActive"`
	RateLimit  int     `json:"rateLimit"`
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt,omitempty"`
}

type APIRequestLog struct {
	ID        int    `json:"id"`
	APIKeyID  int    `json:"apiKeyId"`
	KeyName   string `json:"keyName"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
	IPAddress string `json:"ipAddress"`
	CreatedAt string `json:"createdAt"`
}

// createAPIKey mints a new key for the authenticated user. This is the ONLY
// moment the plaintext exists anywhere outside the caller's own hands: it is
// returned in this one response and then thrown away, because only its SHA-256
// hash reaches the database.
func createAPIKey(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	// getting the object created by server into a variable "c"
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	// Default API Key name
	var req struct {
		Name string `json:"name"`
	}
	// decode the JSON body into a req struct
	_ = c.Bind(&req)
	if req.Name == "" {
		req.Name = "API Key"
	}

	// generate random number for key 256 bits
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to generate key"})
	}
	// Send back the secret key
	// Secret key also hashed and stored in database
	// Hex uses only 0-9a-f: no escaping, no ambiguity, no case sensitivity issues, safe
	plaintext := "sk_live_" + hex.EncodeToString(raw)
	hash := myMiddleware.HashAPIKey(plaintext)

	// Store the hash only. RETURNING id gets the new row's id in the same
	// round trip, so the response can identify the key for later revocation.
	var id int
	err = sqlDB.QueryRow(
		"INSERT INTO api_keys (user_id, key_hash, name) VALUES ($1, $2, $3) RETURNING id",
		userID, hash, req.Name,
	).Scan(&id)
	if err != nil {
		// The detail goes to the server log; the client gets a generic message.
		log.Printf("Error creating API key: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create API key"})
	}

	// 201 Created, and the one and only sighting of `apiKey`.
	return c.JSON(201, map[string]interface{}{
		"id":      id,
		"name":    req.Name,
		"apiKey":  plaintext,
		"warning": "Copy this key now — it will not be shown again.",
	})
}

// listAPIKeys returns metadata only — never the key itself, which is not
// stored and therefore cannot be shown again. Revoked keys are included: the
// UI greys them out rather than hiding them, so a user can see that a key they
// once issued is now dead instead of wondering where it went.
func listAPIKeys(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	rows, err := sqlDB.Query(
		`SELECT id, name, is_active, rate_limit, created_at, last_used_at
		 FROM api_keys WHERE user_id = $1 ORDER BY id ASC`, userID,
	)
	if err != nil {
		log.Printf("Error listing API keys: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to list API keys"})
	}
	defer rows.Close() // close the database connection when this function end

	// Initialised empty, not nil: a nil slice marshals to JSON `null`, which
	// would make the frontend's .map() blow up on a user with no keys.
	keys := []APIKeyInfo{}
	for rows.Next() {
		var k APIKeyInfo
		var createdAt time.Time
		// last_used_at is NULL until the key's first request, so it cannot scan
		// straight into time.Time.
		var lastUsed sql.NullTime
		if err := rows.Scan(&k.ID, &k.Name, &k.IsActive, &k.RateLimit, &createdAt, &lastUsed); err != nil {
			// Skip the unreadable row rather than failing the whole list — one
			// odd row should not hide every other key from the user.
			log.Printf("Error scanning API key: %v", err)
			continue
		}
		// RFC3339 is a format so the browser can parse it with new Date() unambiguously.
		k.CreatedAt = createdAt.Format(time.RFC3339)
		if lastUsed.Valid {
			s := lastUsed.Time.Format(time.RFC3339)
			k.LastUsedAt = &s
		}
		keys = append(keys, k)
	}
	return c.JSON(200, map[string]interface{}{"keys": keys})
}

// revokeAPIKey is a soft delete: is_active = FALSE, the row stays.
// Orphan every past request from that key; and "this key existed and was revoked" is itself
// information worth keeping.
//
// Revocation takes effect on the very next request: APIKeyAuth re-reads
// is_active from the database each time and answers 403, so there is no cached
// state to wait out.
func revokeAPIKey(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}
	keyID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid key id"})
	}

	res, err := sqlDB.Exec(
		"UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND user_id = $2",
		keyID, userID,
	)
	if err != nil {
		log.Printf("Error revoking API key: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to revoke API key"})
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return c.JSON(404, map[string]string{"error": "API key not found"})
	}
	return c.JSON(200, map[string]string{"message": "API key revoked"})
}

// getAPIKeyLogs returns the recent public-API request log across every key the
// user owns — the read side of the audit trail that APIKeyAuth writes after each call.
func getAPIKeyLogs(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	// Check limit of row should be display less thn 500
	limit := 100
	if l := c.QueryParam("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	rows, err := sqlDB.Query(
		`SELECT l.id, l.api_key_id, COALESCE(k.name, ''), l.method, l.path, l.status, COALESCE(l.ip_address, ''), l.created_at
		 FROM api_request_logs l
		 JOIN api_keys k ON k.id = l.api_key_id
		 WHERE k.user_id = $1
		 ORDER BY l.id DESC
		 LIMIT $2`, userID, limit,
	)
	if err != nil {
		log.Printf("Error querying API request logs: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch API logs"})
	}
	defer rows.Close()

	logs := []APIRequestLog{}
	for rows.Next() {
		var lg APIRequestLog
		var createdAt time.Time
		if err := rows.Scan(&lg.ID, &lg.APIKeyID, &lg.KeyName, &lg.Method, &lg.Path, &lg.Status, &lg.IPAddress, &createdAt); err != nil {
			log.Printf("Error scanning API log row: %v", err)
			continue
		}
		lg.CreatedAt = createdAt.Format(time.RFC3339)
		logs = append(logs, lg)
	}
	return c.JSON(200, map[string]interface{}{"logs": logs})
}
