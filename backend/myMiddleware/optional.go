package myMiddleware

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	auth "transcendence/modules/user/auth"
)

// this is helper for the public routes that show more to a signed-in caller
// who is talking?
// a missing Authorization header means an anonymous visitor, so it returns
// (0, "", nil) instead of an error and lets the caller decide what to withhold
// right now only getProductByID uses it, to hide seller phone numbers from
// anonymous visitors while still serving the rest of the listing
// the AI chat no longer calls this: RacketBot is login-only and sits behind
// JWTAuth in the protected group
func OptionalJWTAuth(c echo.Context, db *sql.DB) (int, string, error) {
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" {
		return 0, "", nil
	}
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid auth header")
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := auth.ValidateToken(tokenStr)
	if err != nil {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	if claims.Role != "member" || claims.UserId <= 0 {
		return 0, "", echo.NewHTTPError(http.StatusForbidden, "Member access required")
	}
	var status string
	if err := db.QueryRow(
		"SELECT account_status FROM users WHERE id = $1",
		claims.UserId,
	).Scan(&status); err != nil {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid user")
	}
	if status != "active" {
		return 0, "", echo.NewHTTPError(http.StatusForbidden, "Account is not active")
	}
	return claims.UserId, tokenStr, nil
}
