package chat

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"transcendence/modules/user/auth"
	"transcendence/myMiddleware"
)

type Handler struct {
	Hub     *Hub
	Repo    *Repository
	Service *auth.Service
}

func NewHandler(hub *Hub, repo *Repository, service *auth.Service) *Handler {
	return &Handler{Hub: hub, Repo: repo, Service: service}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	protected := e.Group("")
	protected.Use(myMiddleware.JWTAuth(h.Repo.DB))

	e.GET("/ws", h.WebSocketHandler)
	protected.POST("/messages", h.SendMessage)
	protected.GET("/conversations", h.GetConversations)
	protected.GET("/online-users", h.GetOnlineUsers)
	protected.GET("/people", h.GetPeople)
	protected.DELETE("/conversations/:userId", h.DeleteConversation)
	protected.GET("/messages/:userId", h.GetMessages)
}

func (h *Handler) WebSocketHandler(c echo.Context) error {
	userIdStr := c.QueryParam("token")
	if userIdStr == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "token required as query parameter"})
	}

	claims, err := auth.ValidateToken(userIdStr)
	if err != nil || claims.Role != "member" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
	}
	u, err := h.Repo.GetUserByID(claims.UserId)
	if err != nil || u.AccountStatus != "active" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "account suspended"})
	}

	userId := claims.UserId
	return h.Hub.ServeWS(c, userId)
}

func (h *Handler) SendMessage(c echo.Context) error {
	senderId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	var req InboundMessage
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if req.ReceiverId == 0 || req.Content == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "receiver_id and content required"})
	}

	if req.ReceiverId == senderId {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "cannot send message to yourself"})
	}

	msg, err := h.Repo.CreateMessage(senderId, req.ReceiverId, req.Content)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save message"})
	}

	outbound := OutboundMessage{
		Type:       "private_message",
		SenderId:   msg.SenderId,
		ReceiverId: msg.ReceiverId,
		Content:    msg.Content,
		CreatedAt:  msg.CreatedAt.Format(time.RFC3339),
		Id:         msg.Id,
	}

	payload, _ := json.Marshal(outbound)
	h.Hub.SendPrivateMessage(msg.ReceiverId, payload)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status": "sent",
		"data":   msg,
	})
}

func (h *Handler) GetConversations(c echo.Context) error {
	userId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	conversations, err := h.Repo.GetConversations(userId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch conversations"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"conversations": conversations})
}

func (h *Handler) GetOnlineUsers(c echo.Context) error {
	currentUserID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	onlineIDs, err := h.Hub.OnlineUserIDs(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "online users unavailable"})
	}

	users := make([]OnlineUser, 0, len(onlineIDs))
	for _, userID := range onlineIDs {
		if userID == currentUserID {
			continue
		}
		user, err := h.Repo.GetUserByID(userID)
		if err != nil || user.AccountStatus != "active" {
			continue
		}
		users = append(users, OnlineUser{ID: user.ID, Username: user.Username, AvatarURL: user.AvatarURL})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"users": users})
}

func (h *Handler) GetPeople(c echo.Context) error {
	currentUserID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	role := c.QueryParam("role")
	if role != "" && role != "seller" && role != "buyer" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be seller or buyer"})
	}

	const defaultLimit = 40
	limit := defaultLimit
	if rawLimit := c.QueryParam("limit"); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 100"})
		}
		limit = parsed
	}

	offset := 0
	if rawOffset := c.QueryParam("offset"); rawOffset != "" {
		parsed, err := strconv.Atoi(rawOffset)
		if err != nil || parsed < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "offset must be zero or greater"})
		}
		offset = parsed
	}

	people, err := h.Repo.SearchDirectoryUsers(currentUserID, c.QueryParam("q"), role, limit, offset)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch people"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"people":   people,
		"has_more": len(people) == limit,
	})
}

func (h *Handler) GetMessages(c echo.Context) error {
	currentUserId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	otherUserId, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid user id"})
	}

	messages, err := h.Repo.GetMessagesBetween(currentUserId, otherUserId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch messages"})
	}

	_ = h.Repo.MarkAsRead(currentUserId, otherUserId)

	return c.JSON(http.StatusOK, map[string]interface{}{"messages": messages})
}

func (h *Handler) DeleteConversation(c echo.Context) error {
	userId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}

	partnerId, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid user id"})
	}

	err = h.Repo.DeleteConversation(userId, partnerId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete messages"})
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}

// func (h *Handler) RegisterRoutes(e *echo.Group) {
// 	e.GET("/ws", h.WebSocketHandler)
// 	e.POST("/messages", h.SendMessage, h.AuthMiddleware)
// 	e.GET("/conversations", h.GetConversations, h.AuthMiddleware)
// 	e.DELETE("/conversations/:userId", h.DeleteConversation, h.AuthMiddleware)
// 	e.GET("/messages/:userId", h.GetMessages, h.AuthMiddleware)
// }

//need to create a shared function. DRY
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
