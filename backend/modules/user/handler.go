package user

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm" //orm
    "os"       // Fixes: undefined os tmp
    "path"     // Fixes: undefined path tmp
)

type Handler struct {
	repo *Repository
}

const maxAvatarSize = 2 * 1024 * 1024 //2MB

func NewHandler(gormDB *gorm.DB) (*Handler, error) {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return nil, err
	}

	return &Handler{
		repo: NewRepository(sqlDB, gormDB),
	}, nil
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	e.POST("/auth/register", h.Register)
	e.POST("/auth/login", h.Login)
	e.POST("/auth/verify-otp", h.Verify2FA)
	e.POST("/auth/resend-otp", h.ResendOtp)
	e.GET("/me", h.GetCurrentUser)
	e.GET("/users/:id", h.GetProfile)
	e.PUT("/users/update", h.UpdateProfile)

	e.POST("/users/:id/upload-avatar", h.UploadAvatar)
	e.GET("/users/:id/avatar", h.GetAvatar)

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
		return c.JSON(http.StatusConflict, map[string]string{"error": "User with this email or username already exists/Input error"})
	}

	user, err := h.repo.GetUserByID(int(id))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Error fetching created user"})
	}

	// token := fmt.Sprintf("token_%d", id)
	return c.JSON(http.StatusCreated, map[string]interface{}{"message" : "Register successful! Please login", "user" : user})
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

	if (!user.Requires2FA) {
		token := fmt.Sprintf("token_%d", user.ID)
		return c.JSON(http.StatusOK, LoginResponse{Token: token, User: *user})
	}

	tempToken, err := h.get2FA(req.Email); 
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "OTP failed to send"})
	}

	return c.JSON(http.StatusAccepted, LoginResponse{TempToken: tempToken, NeedOtp: true})

	// token := fmt.Sprintf("token_%d", user.ID)
	// return c.JSON(http.StatusOK, LoginResponse{Token: token, User: *user})
}

func (h *Handler) Verify2FA(c echo.Context) error {
	var otpReq OTPrequest
	if err := c.Bind(&otpReq); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid OTP request payload"})
	}
	if strings.TrimSpace(otpReq.TempToken) == "" || strings.TrimSpace(otpReq.OtpCode) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "tempToken and otpCode are required"})
	}

	email, err := h.repo.VerifyOTPAndConsume(otpReq.TempToken, otpReq.OtpCode)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired OTP"})
	}

	user, err := h.repo.GetUserByEmail(email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load user"})
	}

	token := fmt.Sprintf("token_%d", user.ID)
	return c.JSON(http.StatusOK, LoginResponse{Token: token, User: *user})

}

func (h *Handler) ResendOtp(c echo.Context) error {
	var req ResendOtpRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid OTP request"})
	}
	if strings.TrimSpace(req.Email) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "email is required"})
	}

	_, err := h.repo.GetUserByEmail(req.Email)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "User not found"})
	}

	tempToken, err := h.get2FA(req.Email) 
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "OTP failed to send"})
	}
	return c.JSON(http.StatusAccepted, map[string]string{"tempToken": tempToken, "message": "OTP resent"})
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
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid id format"})
	}

	user, err := h.repo.GetUserByID(id)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	return c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateProfile(c echo.Context) error {
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer token_") {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	idStr := strings.TrimPrefix(authHeader, "Bearer token_")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}

	if err := h.repo.UpdateUserProfile(id, req); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update profile"})
	}

	user, _ := h.repo.GetUserByID(id)
	return c.JSON(http.StatusOK, user)
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

func (h *Handler) UploadAvatar(c echo.Context) error {
	fmt.Printf("in upload avatar\n") //debug
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user id"})
	}

	fileHeader, err := c.FormFile("avatar")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "avatar file is required (multipart/form-data)"})
	}

	if fileHeader.Size <= 0 || fileHeader.Size > maxAvatarSize {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "avatar must be > 0 and <= 2MB"})
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "cannot open uploaded file"})
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "cannot read uploaded file"})
	}

	detected := http.DetectContentType(data) // a better way to check data type rather than the extension only. every file type (.img/.jpg/ .exe) has their own binary that unique for the first 50
	mimeToExt := map[string]string{
		"image/jpeg": "jpeg",
		"image/png": "png",
		"image/webp": "webp",
	}
	ext, ok := mimeToExt[detected]
	if !ok{
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "only jpeg/png/webp allowed"})
	}

	storageDir := "static/avatars"
	if err := os.MkdirAll(storageDir, 0755); err != nil { //return nothing if folder already created
		return c.JSON(http.StatusInternalServerError, map[string]string{"error":"failed to create storage dir"})
	}

	filename := fmt.Sprintf("avatar=%d.%s", userID, ext)
	fullpath := path.Join(storageDir, filename)
	fmt.Printf("full path: %s\n", fullpath) //debug

	if err := os.WriteFile(fullpath, data, 0644); err != nil {
		fmt.Printf("write file error\n") //debug
		return c.JSON(http.StatusInternalServerError, map[string]string{"error":"failed to save avatar file"})
	}

	publicUrl := fmt.Sprintf("/static/avatars/%s", filename)

	if err := h.repo.UpdateUserAvatarUrl(userID, publicUrl, detected); err != nil {
		fmt.Printf("update avatar error\n") //debug
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save avatar"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "avatar uploaded", "avatarUrl": publicUrl})
}

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

	return c.Blob(http.StatusOK, mimeType, data) //blob send data as rawslice of bytes directly to the user browser as a file/data stream. media unlike test cannot be send as JSON
}