package ai

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v4"
	"transcendence/myMiddleware"
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

type Handler struct {
	rawDB *sql.DB
}

func NewHandler(rawDB *sql.DB) *Handler {
	return &Handler{rawDB: rawDB}
}

func (h *Handler) RegisterRoutes(v1 *echo.Group) {
	protected := v1.Group("")
	protected.Use(myMiddleware.JWTAuth(h.rawDB))
	// Logged-in members only. Guest chat is not useful: order/profile tools
	// need a member JWT, and the floating chat UI is hidden until login.
	// JWTAuth rejects anonymous callers, expired tokens, and non-member
	// (admin) tokens before Chat runs.
	protected.POST("/ai/chat", h.Chat) // the main chat endpoint, proxies to FastAPI and streams SSE back
}

const racketbotProxyHeader = "X-Racketbot-Proxy"

// Chat proxies the browser request to FastAPI (ai:8000) and streams SSE back.
func (h *Handler) Chat(c echo.Context) error {
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

	// JWTAuth already set these. Re-check so Chat never forwards an empty
	// identity if this handler is moved off the protected group.
	userID, _ := c.Get("userId").(int)
	authToken, _ := c.Get("token").(string)
	if userID <= 0 || authToken == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Please log in to chat with RacketBot"})
	}

	// 2. Prepare payload to Python AI Service, by build another struct
	// with current existing message, history, recommendation + userId and authToken
	aiReq := AIChatRequest{
		Message:               userReq.Message,
		History:               userReq.History,
		UserID:                userID,
		AuthToken:             authToken,
		RecommendationProfile: userReq.RecommendationProfile,
	}
	// convert the struct to bytes, so we can send to python fastapi
	jsonData, err := json.Marshal(aiReq)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed parsing request"})
	}

	// AI SERVICE URL  is environment variable outside of the code
	// send to ai service, the url is in the environment variable AI_SERVICE_URL, if not set, default to http://ai:8000
	aiServiceURL := os.Getenv("AI_SERVICE_URL")
	if aiServiceURL == "" {
		aiServiceURL = "http://ai:8000"
	}

	// 3. Request the streaming response from Python FastAPI
	
	// build outbound http request to the AI service, with the json data as body, which is the message, history, recommendation + userId and authToken to send to the ai service
	// create the link to later to call api
	req, err := http.NewRequest("POST", aiServiceURL+"/chat", bytes.NewBuffer(jsonData))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed creating backend request"})
	}
	req.Header.Set("Content-Type", "application/json")
	// Shared secret so only this Go proxy can call FastAPI /chat on the compose network, for safety, fast api can reject caller that is not this go proxy, that is not user jwt
	if secret := os.Getenv("AI_INTERNAL_SECRET"); secret != "" {
		req.Header.Set(racketbotProxyHeader, secret)
	}

		
	// calling the api to ai service is here  <=  the actual calling start here, the previous code is just preparing the request to send to the ai service
	// Keep a small margin above the AI service's default 60-second total
	// request budget so a broken downstream connection cannot hang forever.
	resp, err := aiHTTPClient.Do(req)
	if err != nil {
		log.Printf("Error contacting AI service: %v", err)
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "AI Customer Service is temporarily unavailable"})
	}
	defer resp.Body.Close() // ensure the response body is closed after reading, so that the connection is not leaked

	if resp.StatusCode != http.StatusOK {
		log.Printf("AI service returned error HTTP %d", resp.StatusCode)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "AI Service returned an error"})
	}

	// 4. Stream response to Next.js using Server-Sent Events (SSE)
	c.Response().Header().Set(echo.HeaderContentType, "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().WriteHeader(http.StatusOK)

	// read the python stream in 512 byte chunks, write each chunk to the browser, and flush, stop at EOF or error.
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
