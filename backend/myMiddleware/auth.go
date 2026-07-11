package myMiddleware

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	auth "transcendence/modules/user/auth"
)

func JWTAuth(db *sql.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := auth.ValidateToken(tokenStr)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
			}
			if claims.Role != "member" || claims.UserId <= 0 {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Forbidden"})
			}
			var status string
			if err := db.QueryRow("SELECT account_status FROM users WHERE id = $1", claims.UserId).Scan(&status); err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid user"})
			}
			if status != "active" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Account suspended"})
			}

			c.Set("userId", claims.UserId)
			return next(c)
		}
	}

}

func AdminAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			}
			claims, err := auth.ValidateToken(strings.TrimPrefix(authHeader, "Bearer "))
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
			}
			if claims.Role != "admin" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator access required"})
			}
			return next(c)
		}
	}
}
