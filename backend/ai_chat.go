package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	auth "transcendence/modules/user/auth"
)

// AIChatMessage represents a single message in the chat history.
type AIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// what go sends to python fastapi, with the userId and authToken if the user is logged in
type AIChatRequest struct {
	Message               string            `json:"message"`
	History               []AIChatMessage   `json:"history"`
	UserID                int               `json:"userId"`
	AuthToken             string            `json:"authToken,omitempty"`
	RecommendationProfile map[string]string `json:"recommendationProfile,omitempty"`
}

// share http client with a timeout to avoid hanging connections to the AI service
var aiHTTPClient = &http.Client{Timeout: 70 * time.Second}

// this is helper for handleAIChat
// who is talking?
// still allow public access to the AI chat, but if the user is logged in, we will pass the userId and authToken to the AI chat service
// wihtout login, some question is not allowed
// for example, whats are my order, my profile, my account, etc. will not be allowed without login
func getOptionalJWTAuth(c echo.Context, db *sql.DB) (int, string, error) {
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" {
		return 0, "", nil
	}
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid auth header")
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := auth.ValidateToken(tokenStr)
	if err != nil {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	if claims.Role != "member" || claims.UserId <= 0 {
		return 0, "", echo.NewHTTPError(http.StatusForbidden, "Member access required")
	}
	var status string
	if err := db.QueryRow(
		"SELECT account_status FROM users WHERE id = $1",
		claims.UserId,
	).Scan(&status); err != nil {
		return 0, "", echo.NewHTTPError(http.StatusUnauthorized, "Invalid user")
	}
	if status != "active" {
		return 0, "", echo.NewHTTPError(http.StatusForbidden, "Account is not active")
	}
	return claims.UserId, tokenStr, nil
}

// this is the function that handles the AI chat request, it will send the request to the python fastapi service, and stream the response back to the frontend
func handleAIChat(c echo.Context, db *sql.DB) error {
	// read the chat, browser sends in json body
	// declare empty go struct
	var userReq struct {
		Message               string            `json:"message"`
		History               []AIChatMessage   `json:"history"`
		RecommendationProfile map[string]string `json:"recommendationProfile"`
	}
	//fill in the struct with the json body
	if err := c.Bind(&userReq); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	// 1. Resolve JWT auth context if present. Guest AI chat remains allowed.
	// the ai response style based on getOptionalJWTAuth, if the user is logged in, we will pass the userId and authToken to the AI chat service
	userID, authToken, err := getOptionalJWTAuth(c, db)
	if err != nil {
		return err
	}

	// 2. Prepare payload to Python AI Service, by build another struct
	aiReq := AIChatRequest{
		Message:               userReq.Message,
		History:               userReq.History,
		UserID:                userID,
		AuthToken:             authToken,
		RecommendationProfile: userReq.RecommendationProfile,
	}
	// convert the struct to json
	jsonData, err := json.Marshal(aiReq)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed parsing request"})
	}
	// send to ai service, the url is in the environment variable AI_SERVICE_URL, if not set, default to http://ai:8000
	aiServiceURL := os.Getenv("AI_SERVICE_URL")
	if aiServiceURL == "" {
		aiServiceURL = "http://ai:8000"
	}

	// 3. Request the streaming response from Python FastAPI

	// create the link to later to call api
	req, err := http.NewRequest("POST", aiServiceURL+"/chat", bytes.NewBuffer(jsonData))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed creating backend request"})
	}
	req.Header.Set("Content-Type", "application/json")

	// Keep a small margin above the AI service's default 60-second total
	// request budget so a broken downstream connection cannot hang forever.
	// calling the api to ai service is here
	resp, err := aiHTTPClient.Do(req)
	if err != nil {
		log.Printf("Error contacting AI service: %v", err)
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "AI Customer Service is temporarily unavailable"})
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("AI service returned error HTTP %d", resp.StatusCode)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "AI Service returned an error"})
	}

	// 4. Stream response to Next.js using Server-Sent Events (SSE)
	c.Response().Header().Set(echo.HeaderContentType, "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)

	buf := make([]byte, 512)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := c.Response().Write(buf[:n])
			if writeErr != nil {
				break
			}
			c.Response().Flush()
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
	}

	return nil
}
