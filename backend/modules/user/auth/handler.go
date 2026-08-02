package auth

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
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

const oauthSessionMaxAge = 24 * 60 * 60

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
	e.POST("/auth/logout", h.Logout)
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
		log.Printf("Error sending login OTP: %v", err)
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
	if u.OAuthProvider == "google" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Google-authenticated accounts cannot change their password"})
	}
	withPassword, err := h.repo.GetUserByEmailWithPassword(u.Email)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(withPassword.PasswordHash), []byte(req.CurrentPassword)) != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Current password is incorrect"})
	}
	tempToken, err := h.service.GenerateAndSendOTP(u.Email)
	if err != nil {
		log.Printf("Error sending password-change OTP: %v", err)
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
	if u.OAuthProvider == "google" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Google-authenticated accounts cannot change their password"})
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
		log.Printf("Error resending OTP: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "OTP failed to send"})
	}
	return c.JSON(http.StatusAccepted, map[string]string{"tempToken": tempToken, "message": "OTP sent"})
}

func (h *Handler) GoogleLogin(c echo.Context) error {
	if googleOAuthConfig.ClientID == "" || googleOAuthConfig.ClientSecret == "" || googleOAuthConfig.RedirectURL == "" {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "Google OAuth is not configured"})
	}
	state := uuid.NewString()
	c.SetCookie(&http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		HttpOnly: true,
		Path:     "/",
		MaxAge:   600,
		Secure:   useSecureCookies(c),
		SameSite: http.SameSiteLaxMode,
	})
	url := googleOAuthConfig.AuthCodeURL(state)
	return c.Redirect(http.StatusTemporaryRedirect, url)
}

func (h *Handler) GoogleCallback(c echo.Context) error {
	state := c.QueryParam("state")
	cookie, err := c.Cookie("oauth_state")
	expireOAuthCookie(c, "oauth_state")
	if err != nil || state == "" || cookie.Value != state {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid OAuth state"})
	}

	code := c.QueryParam("code")
	if code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing authorization code"})
	}
	token, err := googleOAuthConfig.Exchange(c.Request().Context(), code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "token exchange failed"})
	}

	resp, err := googleOAuthConfig.Client(c.Request().Context(), token).Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to get user info"})
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return c.JSON(http.StatusBadGateway, map[string]string{"error": "Google user info request failed"})
	}

	var googleUser googleUserResponse
	if err := json.NewDecoder(resp.Body).Decode(&googleUser); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to parse user info"})
	}
	if googleUser.ID == "" || strings.TrimSpace(googleUser.Email) == "" || !googleUser.VerifiedEmail {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Google account email is not verified"})
	}

	u, err := h.repo.GetUserByEmail(googleUser.Email)
	if err == nil && u != nil {
		if u.OAuthProvider != "google" || u.OAuthID != googleUser.ID {
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
	if u.AccountStatus != "active" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Account suspended"})
	}

	jwtToken, err := GenerateToken(u.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
	}

	c.SetCookie(&http.Cookie{
		Name:     "oauth_token",
		Value:    jwtToken,
		Path:     "/",
		MaxAge:   oauthSessionMaxAge,
		HttpOnly: true,
		Secure:   useSecureCookies(c),
		SameSite: http.SameSiteLaxMode,
	})

	if frontendURL := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/"); frontendURL != "" {
		return c.Redirect(http.StatusTemporaryRedirect, frontendURL+"/auth/callback")
	}

	host := c.Request().Header.Get("X-Forwarded-Host")
	if host == "" {
		host = c.Request().Host
	}
	scheme := c.Request().Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		scheme = "http"
	}
	redirectURL := fmt.Sprintf("%s://%s/auth/callback", scheme, host)
	return c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

func (h *Handler) Logout(c echo.Context) error {
	expireOAuthCookie(c, "oauth_token")
	return c.NoContent(http.StatusNoContent)
}

func expireOAuthCookie(c echo.Context, name string) {
	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   useSecureCookies(c),
		SameSite: http.SameSiteLaxMode,
	})
}

func useSecureCookies(c echo.Context) bool {
	return os.Getenv("ENVIRONMENT") == "production" ||
		c.Request().TLS != nil ||
		strings.EqualFold(c.Request().Header.Get("X-Forwarded-Proto"), "https")
}
