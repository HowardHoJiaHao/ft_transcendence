package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	brevo "github.com/getbrevo/brevo-go/lib"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"transcendence/modules/user"
)

type Service struct {
	repo *user.Repository
}

func NewService(repo *user.Repository) *Service {
	return &Service{repo: repo}
}

const minJWTSecretLength = 32

var jwtSecret []byte //declare a global package scope variable

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
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
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

// func (s *Service) ValidateToken(tokenStr string) (*Claims, error) {
// 	if !strings.HasPrefix(tokenStr, "token_") {
// 		return nil, fmt.Errorf("invalid token format")
// 	}

// 	idStr := strings.TrimPrefix(tokenStr, "token_")
// 	userId, err := strconv.Atoi(idStr)
// 	if err != nil {
// 		return nil, fmt.Errorf("invalid user id in token")
// 	}

// 	_, err = s.repo.GetUserByID(userId)
// 	if err != nil {
// 		return nil, fmt.Errorf("user not found")
// 	}
// 	return &Claims{UserId: userId}, nil
// }

func (s *Service) GenerateAndSendOTP(email string) (string, error) {
	tempToken := uuid.NewString()
	otpCode := GenerateOTP()

	if err := s.repo.SaveOTP(tempToken, email, otpCode); err != nil {
		return "", fmt.Errorf("could not save OTP to DB: %w", err)
	}

	html := fmt.Sprintf("<h1>Your Code</h1><p>Your OTP is: <b>%s</b></p>", otpCode)
	if err := SendEmail(email, "Your Login Code", html); err != nil {
		return "", err
	}

	return tempToken, nil
}

func GenerateOTP() string {
	table := [...]byte{'1', '2', '3', '4', '5', '6', '7', '8', '9', '0'}
	b := make([]byte, 6)
	n, err := io.ReadAtLeast(rand.Reader, b, 6)
	if n != 6 || err != nil {
		return "123456"
	}
	for i := range b {
		b[i] = table[int(b[i])%len(table)]
	}
	return string(b)
}

func SendEmail(receiverEmail, subject, htmlContent string) error {
	ctx := context.Background()
	cfg := brevo.NewConfiguration()
	cfg.AddDefaultHeader("api-key", os.Getenv("BREVO_API_KEY"))
	client := brevo.NewAPIClient(cfg)

	sender := &brevo.SendSmtpEmailSender{Name: "TransBadminton Marketplace", Email: "transcendence.market@yahoo.com"}
	recipient := []brevo.SendSmtpEmailTo{{Email: receiverEmail}}

	email := brevo.SendSmtpEmail{
		Sender:    sender,
		To:        recipient,
		Subject:   subject,
		HtmlContent: htmlContent,
	}

	_, _, err := client.TransactionalEmailsApi.SendTransacEmail(ctx, email)
	if err != nil {
		return fmt.Errorf("failed to send email: %v", err)
	}
	return nil
}

func (s *Service) CheckAndHashNewPassword(req *user.RegisterRequest) error {
	//does password follow the upper letter/min_letters/non-username and contain special char check
	checker := NewPasswordChecker()

	if errors := checker.Check(req.Password, req.Username); len(errors) > 0 {
		return fmt.Errorf("password validation failed: %s", strings.Join(errors, "; "))
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	req.Password = string(hashedPassword)
	return nil
}

func NewPasswordChecker() *PasswordChecker {
	return &PasswordChecker{
		MinLength: 8,
		CheckUsername: true,
		Rules: []PasswordRule{
			{regexp.MustCompile(`[A-Z]`), "must contain uppercase letter"},
			{regexp.MustCompile(`[a-z]`), "must contain lowercase letter"},
			{regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]`), "must contain special character"},
		},
	}
}

func (v *PasswordChecker) Check(password, username string) []string {
	var errors []string

	if len(password) < v.MinLength {
		errors = append(errors, "must be at least  8 characters")
	}

	if v.CheckUsername && strings.Contains(strings.ToLower(password), strings.ToLower(username)) {
		errors = append(errors, "must not contain your username")
	}

	for _, rule := range v.Rules {
		if !rule.Pattern.MatchString(password) {
			errors = append(errors, rule.Message)
		}
	}

	return errors
}
