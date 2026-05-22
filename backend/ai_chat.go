package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/labstack/echo/v4"
)

type AIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AIChatRequest struct {
	Message string          `json:"message"`
	History []AIChatMessage `json:"history"`
	UserID  int             `json:"userId"`
}

func handleAIChat(c echo.Context) error {
	var userReq struct {
		Message string          `json:"message"`
		History []AIChatMessage `json:"history"`
	}

	if err := c.Bind(&userReq); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	// 1. Resolve Auth user ID if present (optional auth context)
	userID, _ := extractUserID(c)

	// 2. Prepare payload to Python AI Service
	aiReq := AIChatRequest{
		Message: userReq.Message,
		History: userReq.History,
		UserID:  userID,
	}

	jsonData, err := json.Marshal(aiReq)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed parsing request"})
	}

	aiServiceURL := os.Getenv("AI_SERVICE_URL")
	if aiServiceURL == "" {
		aiServiceURL = "http://ai:8000"
	}

	// 3. Request the streaming response from Python FastAPI
	req, err := http.NewRequest("POST", aiServiceURL+"/chat", bytes.NewBuffer(jsonData))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed creating backend request"})
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
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
