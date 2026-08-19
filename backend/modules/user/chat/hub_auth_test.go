package chat

import "testing"

func TestParseWSAuthMessage(t *testing.T) {
	token, err := parseWSAuthMessage([]byte(`{"type":"auth","token":" abc "}`))
	if err != nil {
		t.Fatalf("expected auth message, got %v", err)
	}
	if token != "abc" {
		t.Fatalf("token = %q, want abc", token)
	}

	if _, err := parseWSAuthMessage([]byte(`{"type":"private_message"}`)); err != errMissingWSAuth {
		t.Fatalf("expected missing auth, got %v", err)
	}
	if _, err := parseWSAuthMessage([]byte(`{"type":"auth","token":""}`)); err != errMissingWSAuth {
		t.Fatalf("expected empty token to fail, got %v", err)
	}
}
