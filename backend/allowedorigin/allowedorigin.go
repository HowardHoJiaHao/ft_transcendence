package allowedorigin

import (
	"os"
	"strings"
)

func List() []string {
	origins := []string{
		"http://localhost:3000",
		"http://localhost",
		"https://localhost",
		"https://localhost:8443",
		"http://localhost:8088",
	}
	if frontendURL := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/"); frontendURL != "" {
		origins = append(origins, frontendURL)
	}
	return origins
}

func Check(origin string) bool {
	if origin == "" {
		return false
	}
	for _, allowed := range List() {
		if origin == allowed {
			return true
		}
	}
	return false
}
