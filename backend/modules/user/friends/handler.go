package friends

import (
	"net/http"
	"strconv"
	"log"

	"github.com/labstack/echo/v4"
	"transcendence/modules/user/auth"
	"transcendence/myMiddleware"
)

type Handler struct {
	Repo    *Repository
	Service *auth.Service
}

func NewHandler(repo *Repository, service *auth.Service) *Handler {
	return &Handler{Repo: repo, Service: service}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	protected := e.Group("")
	protected.Use(myMiddleware.JWTAuth())

	protected.GET("/friends", h.GetFriends)
	protected.POST("/friends/:friend_id", h.AddFriend)
	protected.DELETE("/friends/:friend_id", h.RemoveFriend)
}

func (h *Handler) GetFriends(c echo.Context) error {
	id, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error":"unauthorized"})
	}

	friends, err := h.Repo.GetFriends(id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch friends"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"friends": friends})
}

func (h *Handler) AddFriend(c echo.Context) error {
	log.Printf("in here1\n") //debug
	id, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error":"unauthorized"})
	}

	log.Printf("in here2\n") //debug
	friendId, err := strconv.Atoi(c.Param("friend_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid friend id format"})
	}

	log.Printf("in here3\n") //debug
	log.Printf("id: %d, friend id: %d", id, friendId) //debug
	if err := h.Repo.AddFriend(id, friendId); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	log.Printf("in here4\n") //debug
	return c.JSON(http.StatusCreated, map[string]string{"message": "Friend added"})
}

func (h *Handler) RemoveFriend(c echo.Context) error {
	id, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error":"unauthorized"})
	}

	friendId, err := strconv.Atoi(c.Param("friend_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid friend id format"})
	}

	if err := h.Repo.RemoveFriend(id, friendId); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to remove friend"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Friend removed"})
}

// 	func (h *Handler) RegisterRoutes(e *echo.Group) {
// 	e.GET("/friends", h.GetFriends, h.AuthMiddleware)
// 	e.POST("/friends/:friend_id", h.AddFriend, h.AuthMiddleware)
// 	e.DELETE("/friends/:friend_id", h.RemoveFriend, h.AuthMiddleware)
// }

// //need to create a shared function. DRY. can remove and import from mymiddleware auth.go
// func (h *Handler) AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
// 	return func(c echo.Context) error {
// 		authHeader := c.Request().Header.Get("Authorization")
// 		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer") {
// 			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "missing or invalid authorization header"})
// 		}

// 		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
// 		claims, err := auth.ValidateToken(tokenStr)
// 		if err != nil {
// 			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
// 		}

// 		c.Set("userId", claims.UserId)
// 		return next(c)
// 	}
// }