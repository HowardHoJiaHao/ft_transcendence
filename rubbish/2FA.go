package user

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"time"

	brevo "github.com/getbrevo/brevo-go/lib"
	"github.com/google/uuid" //uuid
)

func (h *Handler) get2FA(userEmail string) (string, error) {
	if h == nil || h.repo == nil {
		return "", fmt.Errorf("repository is not initialized")
	}

	tempToken := uuid.NewString()
	otpCode := GenerateOTP()
	if err := h.repo.SaveOTP(tempToken, userEmail, otpCode); err != nil {
		return "", fmt.Errorf("could not save OTP to DB: %w", err)
	}

	html := fmt.Sprintf("<h1>Your Code</h1><p>Your OTP is: <b>%s</b></p>", otpCode)
	if err := SendEmail(userEmail, "Your Login Code", html); err != nil {
		return "", err
	}

	return tempToken, nil
}

func GenerateOTP() string {
	table := [...]byte{'1', '2', '3', '4', '5', '6', '7', '8', '9', '0'}
	b := make([]byte, 6)
	n, err := io.ReadAtLeast(rand.Reader, b, 6) // a fx of request for data
	if n != 6 || err != nil {
		return "123456"
	}
	for i := 0; i < len(b); i++ {
		b[i] = table[int(b[i])%len(table)]
	}
	return string(b)
}

func (r *Repository) SaveOTP(tempToken string, userEmail string, otpCode string) error {

	if r.gormDB == nil {
		return fmt.Errorf("gorm db is not initialized")
	}

	expiryDate := time.Now().Add(5*time.Minute)

	// orm way
	otp := OTP{
		Email:		userEmail,
		Code:		otpCode,
		ExpiryDate:	expiryDate,
		Used:		false,
		TempToken:	tempToken,
	}

	return r.gormDB.Save(&otp).Error
}

func (r *Repository) VerifyOTPAndConsume(tempToken string, otpCode string) (string, error) {
	if r.gormDB == nil {
		return "", fmt.Errorf("gorm db is not initialized")
	}

	//check the field and detect error
	var otp OTP
	err := r.gormDB.Where(
		"temp_token = ? AND code = ? AND used = ? AND expiry_date > ?",
		tempToken, otpCode, false, time.Now(),
	).First(&otp).Error
	if err != nil {
		return "", err
	}

	//take the field from db and changed to these stated value
	err = r.gormDB.Model(&OTP{}).
		Where("email = ?", otp.Email).
		Updates(map[string]interface{}{"used": true, "temp_token": ""}).Error
	if err != nil {
		return "", err
	}

	return otp.Email, nil
}

func SendEmail(receiverEmail string, subject string, htmlContent string) error {
	//Setup config using API key
	ctx := context.Background() //context is a resource management handler. it detects/manage whether a program consume memory or not so should/shouldnt be terminated.
	cfg := brevo.NewConfiguration() // initialize a struct w/ default networking and behaviour settings
	cfg.AddDefaultHeader("api-key", os.Getenv("BREVO_API_KEY"))
	client := brevo.NewAPIClient(cfg)

	//					CREATE EMAIL STRUCT
	//define sender and recipient struct
	sender := &brevo.SendSmtpEmailSender{Name: "TransBadminton Marketplace", Email: "transcendence.market@yahoo.com"}
	recipient := []brevo.SendSmtpEmailTo{{Email: receiverEmail}}

	//fill in email struct
	email := brevo.SendSmtpEmail {
		Sender:			sender,
		To:				recipient,
		Subject:		subject,
		HtmlContent:	htmlContent,
	}

	//we ignore response object and raw network response
	_, _, err := client.TransactionalEmailsApi.SendTransacEmail(ctx, email)
	if err != nil {
		return fmt.Errorf("failed to send email: %v", err)
	}

	return nil
}

//brevo newconfiguration struct
//type Configuration struct {
//	basepath string						// The url
//	useragent string					// The ID
//	defaultheader map[string]string		//where API key goes
//	httpclient *http.Client 			// The transport layer
// }
//
//brevo NewAPIClient struct
//
//


// func saveOTP(db *sql.DB, userEmail string, otpCode string, expiryDate time.Time) error {
//     // The "UPSERT" query: Insert the data, but if the email exists, update the code/expiry.
//     query := `
//         INSERT INTO otps (email, code, expire_date, used)
//         VALUES ($1, $2, $3, $4)
//         ON CONFLICT (email) 
//         DO UPDATE SET 
//             code = EXCLUDED.code, 
//             expire_date = EXCLUDED.expire_date,
//             used = EXCLUDED.used;
//     `
//
//     // Execute the query
//     _, err := db.Exec(query, userEmail, otpCode, expiryDate, false)
//     if err != nil {
//         return fmt.Errorf("could not save otp to database: %v", err)
//     }
//
//     return nil
// }