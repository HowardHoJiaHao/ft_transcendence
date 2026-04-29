package friends

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"transcendence/modules/user"
)

type Handler struct {
	repo *user.Repository
}

func NewHandler(repo *user.Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	e.GET("/users/:id/friends", h.GetFriends)
	e.POST("/users/:id/friends/:friend_id", h.AddFriend)
	e.DELETE("/users/:id/friends/:friend_id", h.RemoveFriend)
}

func (h *Handler) GetFriends(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid id format"})
	}

	friends, err := h.repo.GetFriends(id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch friends"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"friends": friends})
}

func (h *Handler) AddFriend(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid id format"})
	}
	friendID, _ := strconv.Atoi(c.Param("friend_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid friend id format"})
	}

	if err := h.repo.AddFriend(id, friendID); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusCreated, map[string]string{"message": "Friend added"})
}

func (h *Handler) RemoveFriend(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid id format"})
	}
	friendID, _ := strconv.Atoi(c.Param("friend_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid friend id format"})
	}

	if err := h.repo.RemoveFriend(id, friendID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to remove friend"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Friend removed"})
}