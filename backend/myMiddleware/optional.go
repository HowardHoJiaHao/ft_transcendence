package myMiddleware

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"transcendence/modules/user/authjwt"
)

// OptionalJWTAuth is for public routes that show extra fields to a signed-in
// caller. No Authorization header = anonymous (0, "", nil). A present Bearer
// token must be a valid active member; admin tokens are 403.
// Used by getProductByID to hide seller phone numbers from guests.
func OptionalJWTAuth(c echo.Context, db *sql.DB) (int, string, error) {
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" {
		return 0, "", nil
	}
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid auth header")
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := authjwt.ValidateToken(tokenStr)
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
