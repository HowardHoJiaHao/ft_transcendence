package main

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

// createAPIKey generates a new key for the authenticated user. The plaintext
// is returned exactly once; only its SHA-256 hash is stored.
func createAPIKey(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	var req struct {
		Name string `json:"name"`
	}
	_ = c.Bind(&req)
	if req.Name == "" {
		req.Name = "API Key"
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to generate key"})
	}
	plaintext := "sk_live_" + hex.EncodeToString(raw)
	hash := myMiddleware.HashAPIKey(plaintext)

	var id int
	err = sqlDB.QueryRow(
		"INSERT INTO api_keys (user_id, key_hash, name) VALUES ($1, $2, $3) RETURNING id",
		userID, hash, req.Name,
	).Scan(&id)
	if err != nil {
		log.Printf("Error creating API key: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create API key"})
	}

	return c.JSON(201, map[string]interface{}{
		"id":      id,
		"name":    req.Name,
		"apiKey":  plaintext,
		"warning": "Copy this key now — it will not be shown again.",
	})
}

// listAPIKeys returns metadata only — never the key itself (the plaintext is
// not stored anywhere, so it cannot be shown again).
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
		`SELECT id, COALESCE(name, ''), is_active, rate_limit, created_at, last_used_at
		 FROM api_keys WHERE user_id = $1 ORDER BY id DESC`, userID,
	)
	if err != nil {
		log.Printf("Error listing API keys: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to list API keys"})
	}
	defer rows.Close()

	keys := []APIKeyInfo{}
	for rows.Next() {
		var k APIKeyInfo
		var createdAt time.Time
		var lastUsed sql.NullTime
		if err := rows.Scan(&k.ID, &k.Name, &k.IsActive, &k.RateLimit, &createdAt, &lastUsed); err != nil {
			log.Printf("Error scanning API key: %v", err)
			continue
		}
		k.CreatedAt = createdAt.Format(time.RFC3339)
		if lastUsed.Valid {
			s := lastUsed.Time.Format(time.RFC3339)
			k.LastUsedAt = &s
		}
		keys = append(keys, k)
	}
	return c.JSON(200, map[string]interface{}{"keys": keys})
}

// revokeAPIKey deactivates a key (is_active = false). The row is kept so its
// request logs stay attributable.
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

// getAPIKeyLogs returns the recent public-API request log for all keys owned
// by the authenticated user — the safety/audit trail.
func getAPIKeyLogs(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

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
