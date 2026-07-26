package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"transcendence/modules/user"
)

const testJWTSecret = "unit-test-secret-that-is-at-least-32-characters"

func useTestJWTSecret(t *testing.T) {
	t.Helper()
	previous := jwtSecret
	t.Cleanup(func() {
		jwtSecret = previous
	})
	t.Setenv("JWT_SECRET", testJWTSecret)
	jwtSecret = nil
	if err := ConfigureJWTSecretFromEnv(); err != nil {
		t.Fatalf("ConfigureJWTSecretFromEnv() error = %v", err)
	}
}

func TestConfigureJWTSecretRejectsMissingAndWeakSecrets(t *testing.T) {
	previous := jwtSecret
	t.Cleanup(func() {
		jwtSecret = previous
	})

	for _, test := range []struct {
		name   string
		secret string
	}{
		{name: "missing", secret: ""},
		{name: "whitespace", secret: "   "},
		{name: "too short", secret: "short-secret"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("JWT_SECRET", test.secret)
			jwtSecret = nil
			if err := ConfigureJWTSecretFromEnv(); err == nil {
				t.Fatal("ConfigureJWTSecretFromEnv() accepted an unsafe secret")
			}
		})
	}
}

func TestMemberTokenRoundTripAndTamperRejection(t *testing.T) {
	useTestJWTSecret(t)

	token, err := GenerateToken(42)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	claims, err := ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}
	if claims.UserId != 42 || claims.Role != "member" {
		t.Fatalf("claims = %+v, want member user 42", claims)
	}
	if claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) <= 0 {
		t.Fatal("member token does not have a future expiry")
	}

	last := token[len(token)-1]
	replacement := byte('a')
	if last == replacement {
		replacement = 'b'
	}
	tampered := token[:len(token)-1] + string(replacement)
	if _, err := ValidateToken(tampered); err == nil {
		t.Fatal("ValidateToken() accepted a tampered token")
	}
}

func TestValidateTokenRejectsExpiredToken(t *testing.T) {
	useTestJWTSecret(t)

	claims := Claims{
		UserId: 42,
		Role:   "member",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}
	if _, err := ValidateToken(token); err == nil {
		t.Fatal("ValidateToken() accepted an expired token")
	}
}

func TestAdminTokenHasAdminRoleAndExpiry(t *testing.T) {
	useTestJWTSecret(t)

	token, err := GenerateAdminToken()
	if err != nil {
		t.Fatalf("GenerateAdminToken() error = %v", err)
	}
	claims, err := ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}
	if claims.Role != "admin" || claims.UserId != 0 {
		t.Fatalf("admin claims = %+v", claims)
	}
	if claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) <= 0 {
		t.Fatal("admin token does not have a future expiry")
	}
}

func TestPasswordPolicyRejectsCommonWeakPatterns(t *testing.T) {
	checker := NewPasswordChecker()

	tests := []struct {
		name     string
		password string
		username string
		wantPart string
	}{
		{name: "too short", password: "Aa!", username: "user", wantPart: "at least"},
		{name: "missing uppercase", password: "lowercase!", username: "user", wantPart: "uppercase"},
		{name: "missing lowercase", password: "UPPERCASE!", username: "user", wantPart: "lowercase"},
		{name: "missing special", password: "MixedCasePassword", username: "user", wantPart: "special"},
		{name: "contains username case insensitive", password: "Alice!Strong", username: "alice", wantPart: "username"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			errors := strings.Join(checker.Check(test.password, test.username), ";")
			if !strings.Contains(errors, test.wantPart) {
				t.Fatalf("errors = %q, want it to contain %q", errors, test.wantPart)
			}
		})
	}

	if errors := checker.Check("Strong!Password", "alice"); len(errors) != 0 {
		t.Fatalf("strong password rejected: %v", errors)
	}
}

func TestCheckAndHashNewPasswordNeverKeepsPlaintext(t *testing.T) {
	request := user.RegisterRequest{
		Username: "alice",
		Password: "Strong!Password",
	}
	plaintext := request.Password

	if err := (&Service{}).CheckAndHashNewPassword(&request); err != nil {
		t.Fatalf("CheckAndHashNewPassword() error = %v", err)
	}
	if request.Password == plaintext {
		t.Fatal("password remained in plaintext")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(request.Password), []byte(plaintext)); err != nil {
		t.Fatalf("stored password is not a valid hash of the original password: %v", err)
	}
}

func TestGenerateOTPReturnsSixDigits(t *testing.T) {
	otp := GenerateOTP()
	if len(otp) != 6 {
		t.Fatalf("OTP length = %d, want 6", len(otp))
	}
	for _, character := range otp {
		if character < '0' || character > '9' {
			t.Fatalf("OTP contains non-digit character %q", character)
		}
	}
}
