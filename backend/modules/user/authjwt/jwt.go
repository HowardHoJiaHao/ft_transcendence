// Package authjwt is the JWT create/parse leaf so handlers and middleware
// can share tokens without an import cycle (myMiddleware used to import
// user/auth, and user/auth imported myMiddleware for JWTAuth).
package authjwt

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const minJWTSecretLength = 32

type Claims struct {
	UserId int    `json:"user_id"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

var jwtSecret []byte

func ConfigureJWTSecretFromEnv() error {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		return fmt.Errorf("JWT_SECRET is required")
	}
	if len(secret) < minJWTSecretLength {
		return fmt.Errorf("JWT_SECRET must be at least %d characters", minJWTSecretLength)
	}
	jwtSecret = []byte(secret)
	return nil
}

func ensureJWTSecretConfigured() error {
	if len(jwtSecret) == 0 {
		if err := ConfigureJWTSecretFromEnv(); err != nil {
			return err
		}
	}
	if len(jwtSecret) < minJWTSecretLength {
		return fmt.Errorf("JWT_SECRET must be at least %d characters", minJWTSecretLength)
	}
	return nil
}

func GenerateToken(userID int) (string, error) {
	if err := ensureJWTSecretConfigured(); err != nil {
		return "", err
	}
	claims := Claims{
		UserId: userID,
		Role:   "member",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func GenerateAdminToken() (string, error) {
	if err := ensureJWTSecretConfigured(); err != nil {
		return "", err
	}
	claims := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

var keyFunc = func(token *jwt.Token) (interface{}, error) {
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
	}
	if err := ensureJWTSecretConfigured(); err != nil {
		return nil, err
	}
	return jwtSecret, nil
}

func ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, keyFunc)
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid claims")
	}
	return claims, nil
}
