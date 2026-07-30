package profile

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"database/sql"
	"github.com/labstack/echo/v4"
	"transcendence/modules/user"
	"transcendence/modules/user/auth"
	"transcendence/myMiddleware"
)

type Handler struct {
	repo    *user.Repository
	service *Service
}

// publicProfile is the member-facing profile shown from listings and the chat
// directory. The People directory itself remains limited to summary fields.
type publicProfile struct {
	ID          int        `json:"id"`
	Username    string     `json:"username"`
	FirstName   string     `json:"firstName"`
	LastName    string     `json:"lastName"`
	PhoneNo     *string    `json:"phoneNo,omitempty"`
	Gender      *string    `json:"gender,omitempty"`
	DateOfBirth *time.Time `json:"dateOfBirth,omitempty"`
	AvatarURL   *string    `json:"avatarUrl,omitempty"`
	Bio         string     `json:"bio"`
}

func NewHandler(repo *user.Repository, service *Service) *Handler {
	return &Handler{repo: repo, service: service}
}

// PublicProfile is the non-owner view of a user. It omits sensitive PII (email,
// date of birth, gender) and account-security fields (2FA requirement, account
// status, OAuth provider). The seller's phone number is contact info and is
// populated only for authenticated requests (see GetProfile), so anonymous
// callers cannot scrape it — while signed-in buyers can still reach the seller.
type PublicProfile struct {
	ID        int     `json:"id"`
	Username  string  `json:"username"`
	FirstName string  `json:"firstName"`
	LastName  string  `json:"lastName"`
	Bio       string  `json:"bio"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
	PhoneNo   *string `json:"phoneNo,omitempty"`
	IsOnline  bool    `json:"onlineStatus"`
	CreatedAt string  `json:"createdAt"`
}

func toPublicProfile(u *user.User) PublicProfile {
	return PublicProfile{
		ID:        u.ID,
		Username:  u.Username,
		FirstName: u.FirstName,
		LastName:  u.LastName,
		Bio:       u.Bio,
		AvatarURL: u.AvatarURL,
		IsOnline:  u.IsOnline,
		CreatedAt: u.CreatedAt.Format(time.RFC3339),
	}
}

// requesterIsAuthenticated reports whether the request carries a valid member
// JWT, checking both the Authorization header and the OAuth cookie (mirroring
// JWTAuth). Used to reveal contact details only to signed-in users.
func (h *Handler) requesterIsAuthenticated(c echo.Context) bool {
	var token string
	authHeader := c.Request().Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	} else if cookie, err := c.Cookie("oauth_token"); err == nil {
		token = cookie.Value
	}
	claims, err := auth.ValidateToken(token)
	if err != nil || claims.Role != "member" || claims.UserId <= 0 {
		return false
	}
	var status string
	return h.repo.DB.QueryRow(
		"SELECT account_status FROM users WHERE id = $1",
		claims.UserId,
	).Scan(&status) == nil && status == "active"
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	protected := e.Group("")
	protected.Use(myMiddleware.JWTAuth(h.repo.DB))

	e.GET("/users/:id", h.GetProfile)
	e.GET("/users/:id/avatar", h.GetAvatar)
	protected.GET("/me", h.GetCurrentUser)
	protected.PUT("/users/update", h.UpdateProfile)
	protected.POST("/users/upload-avatar", h.UploadAvatar)
}

func (h *Handler) GetCurrentUser(c echo.Context) error {
	userId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	userData, err := h.repo.GetUserByID(userId)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}

	token, _ := c.Get("token").(string)
	return c.JSON(http.StatusOK, user.LoginResponse{Token: token, User: *userData})
}

func (h *Handler) GetProfile(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid id format"})
	}

	u, err := h.repo.GetUserByID(id)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	if u.AccountStatus == "deleted" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	profile := toPublicProfile(u)
	// Reveal the seller's phone number only to signed-in users so they can make
	// contact, while anonymous callers still cannot scrape contact PII. Other
	// sensitive fields (email, DOB, gender) are never exposed here — the owner
	// reads their own full record through the authenticated /me route.
	if h.requesterIsAuthenticated(c) {
		profile.PhoneNo = u.PhoneNo
	}
	return c.JSON(http.StatusOK, profile)
}

func (h *Handler) UpdateProfile(c echo.Context) error {
	userId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	var req user.UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}
	if req.Email != nil {
		currentUser, err := h.repo.GetUserByID(userId)
		if err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "User not found"})
		}
		if currentUser.OAuthProvider == "google" {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "Google-authenticated accounts cannot change their email"})
		}
	}

	if err := h.repo.UpdateUserProfile(userId, req); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update profile"})
	}

	user, _ := h.repo.GetUserByID(userId)
	return c.JSON(http.StatusOK, user)
}

// func (h *Handler) UpdateProfile(c echo.Context) error {
// 	authHeader := c.Request().Header.Get("Authorization")
// 	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer token_") {
// 		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
// 	}

// 	idStr := strings.TrimPrefix(authHeader, "Bearer token_")
// 	id, err := strconv.Atoi(idStr)
// 	if err != nil {
// 		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
// 	}

// 	var req user.UpdateProfileRequest
// 	if err := c.Bind(&req); err != nil {
// 		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
// 	}

// 	if err := h.repo.UpdateUserProfile(id, req); err != nil {
// 		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update profile"})
// 	}

// 	user, _ := h.repo.GetUserByID(id)
// 	return c.JSON(http.StatusOK, user)
// }

func (h *Handler) UploadAvatar(c echo.Context) error {
	userId, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	fileHeader, err := c.FormFile("avatar")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "avatar file is required"})
	}

	publicUrl, err := h.service.SaveAvatar(userId, fileHeader)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message":   "avatar uploaded",
		"avatarUrl": publicUrl,
	})
}

// func (h *Handler) UploadAvatar(c echo.Context) error {
// 	userID, err := strconv.Atoi(c.Param("id"))
// 	if err != nil {
// 		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user id"})
// 	}

// 	fileHeader, err := c.FormFile("avatar")
// 	if err != nil {
// 		return c.JSON(http.StatusBadRequest, map[string]string{"error": "avatar file is required"})
// 	}

// 	publicUrl, err := h.service.SaveAvatar(userID, fileHeader)
// 	if err != nil {
// 		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
// 	}

// 	return c.JSON(http.StatusOK, map[string]string{
// 		"message":    "avatar uploaded",
// 		"avatarUrl":  publicUrl,
// 	})
// }

// Currently not being used
func (h *Handler) GetAvatar(c echo.Context) error {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user id"})
	}

	data, mimeType, err := h.repo.GetUserAvatarBinary(userID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "avatar not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch avatar"})
	}

	return c.Blob(http.StatusOK, mimeType, data)
}

// func (h *Handler) GetCurrentUser(c echo.Context) error {
// 	authHeader := c.Request().Header.Get("Authorization")
// 	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer token_") {
// 		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
// 	}

// 	idStr := strings.TrimPrefix(authHeader, "Bearer token_")
// 	id, err := strconv.Atoi(idStr)
// 	if err != nil {
// 		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
// 	}

// 	user, err := h.repo.GetUserByID(id)
// 	if err != nil {
// 		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
// 	}
// 	return c.JSON(http.StatusOK, user)
// }
