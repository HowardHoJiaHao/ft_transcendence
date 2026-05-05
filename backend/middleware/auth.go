package middleware

import (
	"strconv"
	"strings"
	"github.com/labstack/echo/v4"
)

func JWTAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			auth := c.Request().Header.Get("Authorization")
			if auth == "" || !strings.HasPrefix(auth, "Bearer token_") {
				return c.JSON(401, map[string]string{"error": "Unauthorized"})
			}

			userIdStr := strings.TrimPrefix(auth, "Bearer token_")
			userId, err := strconv.Atoi(userIdStr)
			if err != nil {
				return c.JSON(401, map[string]string{"error": "Invalid token"})
			}

			c.Set("userId", userId)
			return next(c)
		}
	}

}