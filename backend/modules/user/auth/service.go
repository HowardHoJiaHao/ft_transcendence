package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"os"

	brevo "github.com/getbrevo/brevo-go/lib"
	"github.com/google/uuid"
	"transcendence/modules/user"
)

type Service struct {
	repo *user.Repository
}

func NewService(repo *user.Repository) *Service {
	return &Service{repo: repo}
}

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