package user

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

type Handler struct {
	repo *Repository
}

func NewHandler(db *sql.DB) *Handler {
	return &Handler{repo: NewRepository(db)}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	e.POST("/auth/register", h.Register)
	e.POST("/auth/login", h.Login)
	e.GET("/me", h.GetCurrentUser)
	e.GET("/users/:id", h.GetProfile)
	e.PUT("/users/:id", h.UpdateProfile)
	
	e.GET("/users/:id/friends", h.GetFriends)
	e.POST("/users/:id/friends/:friend_id", h.AddFriend)
	e.DELETE("/users/:id/friends/:friend_id", h.RemoveFriend)
}

func (h *Handler) Register(c echo.Context) error {
	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}

	id, err := h.repo.CreateUser(req)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "User with this email or username already exists"})
	}

	user, err := h.repo.GetUserByID(int(id))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Error fetching created user"})
	}

	token := fmt.Sprintf("token_%d", id)
	return c.JSON(http.StatusCreated, LoginResponse{Token: token, User: *user})
}

func (h *Handler) Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}

	user, err := h.repo.GetUserByEmailAndPassword(req.Email, req.Password)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	token := fmt.Sprintf("token_%d", user.ID)
	return c.JSON(http.StatusOK, LoginResponse{Token: token, User: *user})
}

func (h *Handler) GetCurrentUser(c echo.Context) error {
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer token_") {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	idStr := strings.TrimPrefix(authHeader, "Bearer token_")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	user, err := h.repo.GetUserByID(id)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	return c.JSON(http.StatusOK, user)
}

func (h *Handler) GetProfile(c echo.Context) error {
	id, _ := strconv.Atoi(c.Param("id"))
	user, err := h.repo.GetUserByID(id)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	return c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateProfile(c echo.Context) error {
	id, _ := strconv.Atoi(c.Param("id"))
	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if err := h.repo.UpdateUserProfile(id, req); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update profile"})
	}

	user, _ := h.repo.GetUserByID(id)
	return c.JSON(http.StatusOK, user)
}

func (h *Handler) GetFriends(c echo.Context) error {
	id, _ := strconv.Atoi(c.Param("id"))
	friends, err := h.repo.GetFriends(id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch friends"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"friends": friends})
}

func (h *Handler) AddFriend(c echo.Context) error {
	id, _ := strconv.Atoi(c.Param("id"))
	friendID, _ := strconv.Atoi(c.Param("friend_id"))

	if err := h.repo.AddFriend(id, friendID); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusCreated, map[string]string{"message": "Friend added"})
}

func (h *Handler) RemoveFriend(c echo.Context) error {
	id, _ := strconv.Atoi(c.Param("id"))
	friendID, _ := strconv.Atoi(c.Param("friend_id"))

	if err := h.repo.RemoveFriend(id, friendID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to remove friend"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Friend removed"})
}
