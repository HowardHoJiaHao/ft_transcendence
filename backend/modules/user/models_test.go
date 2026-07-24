package user

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestUserJSONNeverExposesSensitiveAuthenticationOrBinaryFields(t *testing.T) {
	user := User{
		ID:            42,
		Username:      "alice",
		Email:         "alice@example.com",
		PasswordHash:  "secret-password-hash",
		OAuthID:       "private-oauth-identifier",
		AvatarData:    []byte("private-binary-avatar"),
		OAuthProvider: "google",
		AccountStatus: "active",
		HasAvatarBin:  true,
		Requires2FA:   true,
	}

	encoded, err := json.Marshal(user)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	output := string(encoded)

	for _, secret := range []string{
		"secret-password-hash",
		"private-oauth-identifier",
		"private-binary-avatar",
		"PasswordHash",
		"AvatarData",
		"OAuthID",
	} {
		if strings.Contains(output, secret) {
			t.Fatalf("sensitive value %q leaked in user JSON: %s", secret, output)
		}
	}
	if !strings.Contains(output, `"username":"alice"`) {
		t.Fatalf("expected public user fields in JSON: %s", output)
	}
}
