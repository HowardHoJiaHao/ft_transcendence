package friends

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"transcendence/modules/user/auth"
	"transcendence/modules/user/notifications"
	"transcendence/myMiddleware"
)

type Handler struct {
	Repo          *Repository
	Service       *auth.Service
	Notifications *notifications.Service
}

func NewHandler(repo *Repository, service *auth.Service) *Handler {
	return &Handler{Repo: repo, Service: service}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	protected := e.Group("")
	protected.Use(myMiddleware.JWTAuth(h.Repo.DB))

	protected.GET("/friends", h.GetFriends)
	protected.POST("/friends/:friend_id", h.AddFriend)
	protected.DELETE("/friends/:friend_id", h.RemoveFriend)
}

func (h *Handler) GetFriends(c echo.Context) error {
	id, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	friends, err := h.Repo.GetFriends(id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch friends"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"friends": friends})
}

func (h *Handler) AddFriend(c echo.Context) error {
	id, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	friendId, err := strconv.Atoi(c.Param("friend_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid friend id format"})
	}

	var notificationID int64
	if h.Notifications != nil {
		notificationID, err = h.Repo.AddFriendWithNotification(id, friendId, h.Notifications.Repo)
	} else {
		err = h.Repo.AddFriend(id, friendId)
	}
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if h.Notifications != nil {
		h.Notifications.PublishByID(friendId, notificationID)
	}

	return c.JSON(http.StatusCreated, map[string]string{"message": "Friend added"})
}

func (h *Handler) RemoveFriend(c echo.Context) error {
	id, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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