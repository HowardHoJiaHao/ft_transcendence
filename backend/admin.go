package main

import (
	"crypto/subtle"
	"database/sql"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"transcendence/modules/user/auth"
	"transcendence/myMiddleware"
)

type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type adminUser struct {
	ID            int    `json:"id"`
	Username      string `json:"username"`
	Email         string `json:"email"`
	AccountStatus string `json:"accountStatus"`
}

type updateAccountStatusRequest struct {
	AccountStatus string `json:"accountStatus"`
}

func registerAdminRoutes(v1 *echo.Group, db *sql.DB) {
	v1.POST("/admin/auth/login", adminLogin)
	admin := v1.Group("/admin")
	admin.Use(myMiddleware.AdminAuth())
	admin.GET("/users", func(c echo.Context) error { return listAdminUsers(c, db) })
	admin.PATCH("/users/:id/status", func(c echo.Context) error { return updateAdminUserStatus(c, db) })
}

func adminLogin(c echo.Context) error {
	var req adminLoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}
	expectedUsername := strings.TrimSpace(os.Getenv("ADMIN_USERNAME"))
	passwordHash := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_HASH"))
	if expectedUsername == "" || passwordHash == "" {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "Administrator login is not configured"})
	}
	usernameMatches := subtle.ConstantTimeCompare([]byte(req.Username), []byte(expectedUsername)) == 1
	passwordMatches := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) == nil
	// For the academic MVP, also accept a plaintext test password in this
	// environment variable. A valid bcrypt hash remains the preferred format.
	if !passwordMatches {
		passwordMatches = subtle.ConstantTimeCompare([]byte(req.Password), []byte(passwordHash)) == 1
	}
	if !usernameMatches || !passwordMatches {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid administrator credentials"})
	}
	token, err := auth.GenerateAdminToken()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}
	return c.JSON(http.StatusOK, map[string]string{"token": token})
}

func listAdminUsers(c echo.Context, db *sql.DB) error {
	rows, err := db.Query("SELECT id, username, email, account_status FROM users ORDER BY id ASC")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch users"})
	}
	defer rows.Close()
	users := []adminUser{}
	for rows.Next() {
		var u adminUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.AccountStatus); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read users"})
		}
		users = append(users, u)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"users": users})
}

func updateAdminUserStatus(c echo.Context, db *sql.DB) error {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}
	var req updateAccountStatusRequest
	if err := c.Bind(&req); err != nil || (req.AccountStatus != "active" && req.AccountStatus != "suspended") {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "accountStatus must be active or suspended"})
	}
	result, err := db.Exec("UPDATE users SET account_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", req.AccountStatus, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update user"})
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Account status updated", "accountStatus": req.AccountStatus})
}
