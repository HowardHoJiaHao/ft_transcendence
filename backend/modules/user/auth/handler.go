package auth

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"transcendence/modules/user"
)

type Handler struct {
	repo    *user.Repository
	service *Service
}

func NewHandler(repo *user.Repository, service *Service) *Handler {
	return &Handler{repo: repo, service: service}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	e.POST("/auth/register", h.Register)
	e.POST("/auth/login", h.Login)
	e.POST("/auth/verify-otp", h.Verify2FA)
	e.POST("/auth/resend-otp", h.ResendOtp)
}

func (h *Handler) Register(c echo.Context) error {
	var req user.RegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}

	if err := h.service.CheckAndHashNewPassword(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	id, err := h.repo.CreateUser(req)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "User with this email or username already exists"})
	}

	u, err := h.repo.GetUserByID(int(id))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Error fetching created user"})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"message": "Register successful! Please login",
		"user":    u,
	})
}

func (h *Handler) Login(c echo.Context) error {
	var req user.LoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}

	u, err := h.repo.GetUserByEmailWithPassword(req.Email)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials 1"})
	}

	if err = bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials 2"})
	}
	if u.AccountStatus != "active" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Account suspended"})
	}

	if !u.Requires2FA {
		token, err := GenerateToken(u.ID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		}
		return c.JSON(http.StatusOK, user.LoginResponse{Token: token, User: *u})
	}

	tempToken, err := h.service.GenerateAndSendOTP(req.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "OTP failed to send"})
	}

	return c.JSON(http.StatusAccepted, user.LoginResponse{TempToken: tempToken, NeedOtp: true})
}

func (h *Handler) RequestPasswordChange(c echo.Context) error {
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}
	var req user.ChangePasswordRequest
	if err := c.Bind(&req); err != nil || strings.TrimSpace(req.CurrentPassword) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Current password is required"})
	}
	u, err := h.repo.GetUserByID(userID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "User not found"})
	}
	withPassword, err := h.repo.GetUserByEmailWithPassword(u.Email)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(withPassword.PasswordHash), []byte(req.CurrentPassword)) != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Current password is incorrect"})
	}
	tempToken, err := h.service.GenerateAndSendOTP(u.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "OTP failed to send"})
	}
	return c.JSON(http.StatusAccepted, map[string]string{"tempToken": tempToken, "message": "OTP sent"})
}

func (h *Handler) ConfirmPasswordChange(c echo.Context) error {
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}
	var req user.ConfirmPasswordChangeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}
	if req.NewPassword != req.ConfirmPassword {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "New passwords do not match"})
	}
	u, err := h.repo.GetUserByID(userID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "User not found"})
	}
	passwordRequest := user.RegisterRequest{Username: u.Username, Password: req.NewPassword}
	if err := h.service.CheckAndHashNewPassword(&passwordRequest); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	email, err := h.repo.VerifyOTPAndConsume(req.TempToken, req.OtpCode)
	if err != nil || email != u.Email {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid or expired OTP"})
	}
	if err := h.repo.UpdatePassword(userID, passwordRequest.Password); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update password"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Password changed successfully. Please log in again."})
}

func (h *Handler) Verify2FA(c echo.Context) error {
	var otpReq user.OTPrequest
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

	u, err := h.repo.GetUserByEmail(email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load user"})
	}
	if u.AccountStatus != "active" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Account suspended"})
	}

	token, err := GenerateToken(u.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
	}
	return c.JSON(http.StatusOK, user.LoginResponse{Token: token, User: *u})
}

func (h *Handler) ResendOtp(c echo.Context) error {
	var req user.ResendOtpRequest
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

	tempToken, err := h.service.GenerateAndSendOTP(req.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "OTP failed to send"})
	}
	return c.JSON(http.StatusAccepted, map[string]string{"tempToken": tempToken, "message": "OTP sent"})
}
