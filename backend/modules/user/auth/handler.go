package auth

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"transcendence/modules/user"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type Handler struct {
	repo    *user.Repository
	service *Service
}

var googleOAuthConfig = &oauth2.Config{
	ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
	ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
	RedirectURL:  os.Getenv("GOOGLE_REDIRECT_URL"),
	Scopes:       []string{"https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"},
	Endpoint:     google.Endpoint,
}

func NewHandler(repo *user.Repository, service *Service) *Handler {
	return &Handler{repo: repo, service: service}
}

func (h *Handler) RegisterRoutes(e *echo.Group) {
	e.POST("/auth/register", h.Register)
	e.POST("/auth/login", h.Login)
	e.POST("/auth/verify-otp", h.Verify2FA)
	e.POST("/auth/resend-otp", h.ResendOtp)
	e.GET("/auth/google", h.GoogleLogin)
	e.GET("/auth/google/callback", h.GoogleCallback)
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

func (h *Handler) GoogleLogin(c echo.Context) error {
	state := uuid.NewString()
	c.SetCookie(&http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		HttpOnly: true,
		Path:     "/",
		MaxAge:   600,
	})
	url := googleOAuthConfig.AuthCodeURL(state)
	return c.Redirect(http.StatusTemporaryRedirect, url)
}

func (h *Handler) GoogleCallback(c echo.Context) error {
	// take cookie coming from request. compare with the one in browser
	state := c.QueryParam("state")
	cookie, err := c.Cookie("oauth_state")
	if err != nil || cookie.Value != state {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "token exhange failed"})
	}

	// take code cause its verified.
	code := c.QueryParam("code")
	token, err := googleOAuthConfig.Exchange(c.Request().Context(), code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "token exchange failed"})
	}

	// Fetch user info from Google
	resp, err := googleOAuthConfig.Client(c.Request().Context(), token).Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to get user info"})
	}
	defer resp.Body.Close()

	var googleUser googleUserResponse
	if err := json.NewDecoder(resp.Body).Decode(&googleUser); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to parse user info"})
	}

	// Create user and get it
	u, err := h.repo.GetUserByEmail(googleUser.Email)
	if err == nil && u != nil {
		if u.OAuthProvider != "google" {
			return c.JSON(http.StatusConflict, map[string]string{"error": "You already have an account with this email. Please sign in with your existing method."})
		}
	} else {
		if err != sql.ErrNoRows {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load user"})
		}
		id, err := h.repo.CreateOAuthUser(user.OAuthUserPayload{
			Email:         googleUser.Email,
			Username:      googleUser.Email,
			FirstName:     googleUser.GivenName,
			LastName:      googleUser.FamilyName,
			AvatarURL:     googleUser.Picture,
			OAuthID:       googleUser.ID,
			OAuthProvider: "google",
		})
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create user"})
		}

		u, err = h.repo.GetUserByID(int(id))
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load user"})
		}
	}

	//Generate JWT
	jwtToken, err := GenerateToken(u.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
	}

	c.SetCookie(&http.Cookie{
		Name:     "oauth_token",
		Value:    jwtToken,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
	})

	frontendURL := os.Getenv("FRONTEND_URL")
	redirectURL := fmt.Sprintf("%s/auth/callback", frontendURL)
	return c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}
