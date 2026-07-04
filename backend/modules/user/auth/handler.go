package auth

import (
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"github.com/labstack/echo/v4"
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
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()});
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
