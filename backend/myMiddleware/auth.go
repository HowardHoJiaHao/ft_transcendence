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
			var tokenStr string
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			} else {
				cookie, err := c.Cookie("oauth_token")
				if err != nil || cookie.Value == "" {
					return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
				}
				tokenStr = cookie.Value
			}
			claims, err := auth.ValidateToken(tokenStr)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
			}
			if claims.Role != "member" || claims.UserId <= 0 {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Forbidden"})
			}
			var status, role string
			if err := db.QueryRow("SELECT account_status, role FROM users WHERE id = $1", claims.UserId).Scan(&status, &role); err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid user"})
			}
			if status != "active" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Account is not active"})
			}

			c.Set("userId", claims.UserId)
			c.Set("userRole", role)
			c.Set("token", tokenStr)
			return next(c)
		}
	}

}

func AdminAuth(db *sql.DB) echo.MiddlewareFunc {
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
			// The environment-configured bootstrap administrator has no
			// users row. It remains available to assign the first database
			// administrator and is always treated as an admin.
			if claims.Role == "admin" && claims.UserId == 0 {
				c.Set("userRole", "admin")
				c.Set("adminUserId", 0)
				return next(c)
			}
			if claims.Role != "member" || claims.UserId <= 0 {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator access required"})
			}
			var status, role string
			if err := db.QueryRow(
				"SELECT account_status, role FROM users WHERE id = $1",
				claims.UserId,
			).Scan(&status, &role); err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid user"})
			}
			if status != "active" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Account is not active"})
			}
			// check if the user is an admin or moderator, if not then return forbidden
			// then it will allow the admin to access the admin page, and moderator to access the moderator page
			if role != "admin" && role != "moderator" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator or moderator access required"})
			}
			c.Set("userRole", role)
			c.Set("adminUserId", claims.UserId)
			return next(c)
		}
	}
}
