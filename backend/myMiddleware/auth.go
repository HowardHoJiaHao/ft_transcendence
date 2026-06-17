package myMiddleware

import (
	"net/http"
	"strings"
	"github.com/labstack/echo/v4"
	auth "transcendence/modules/user/auth"
)

func JWTAuth() echo.MiddlewareFunc {
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

			c.Set("userId", claims.UserId)
			return next(c)
		}
	}

}