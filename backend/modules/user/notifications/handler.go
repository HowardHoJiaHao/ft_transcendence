package notifications

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"transcendence/myMiddleware"
)

type Handler struct {
	Service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{Service: service}
}

func (h *Handler) RegisterRoutes(group *echo.Group) {
	protected := group.Group("")
	protected.Use(myMiddleware.JWTAuth(h.Service.Repo.DB))
	protected.GET("/notifications", h.List)
	protected.PATCH("/notifications/read", h.MarkRead)
}

func currentUserID(c echo.Context) (int, bool) {
	id, ok := c.Get("userId").(int)
	return id, ok && id > 0
}

func (h *Handler) List(c echo.Context) error {
	userID, ok := currentUserID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	limit := 20
	if raw := c.QueryParam("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 100"})
		}
		limit = value
	}

	response, err := h.Service.Repo.List(userID, limit, c.QueryParam("before"))
	if err != nil {
		if err.Error() == "invalid cursor" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid cursor"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch notifications"})
	}
	return c.JSON(http.StatusOK, response)
}

func (h *Handler) MarkRead(c echo.Context) error {
	userID, ok := currentUserID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	var request ReadRequest
	if err := c.Bind(&request); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
	}
	if len(request.IDs) < 1 || len(request.IDs) > 100 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "ids must contain between 1 and 100 items"})
	}
	seen := make(map[int64]struct{}, len(request.IDs))
	for _, id := range request.IDs {
		if id <= 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "ids must be positive"})
		}
		if _, exists := seen[id]; exists {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "ids must be unique"})
		}
		seen[id] = struct{}{}
	}

	unread, err := h.Service.Repo.MarkRead(userID, request.IDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to mark notifications read"})
	}
	return c.JSON(http.StatusOK, ReadResponse{UnreadCount: unread})
}
