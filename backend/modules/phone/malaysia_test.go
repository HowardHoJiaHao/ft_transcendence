package phone

import "testing"

func TestNormalizeValid(t *testing.T) {
	cases := map[string]string{
		"012-345 6789":    "+60123456789",
		"0123456789":      "+60123456789",
		"+60 12 345 6789": "+60123456789",
		"60123456789":     "+60123456789",
		"011-1234 5678":   "+601112345678",
		"015-4123 4567":   "+601541234567",
		"03-1234 5678":    "+60312345678",
		"04-123 4567":     "+6041234567",
		"082-123456":      "+6082123456",
		"(019) 876-5432":  "+60198765432",
		"":                "",
	}
	for raw, want := range cases {
		got, ok := Normalize(raw)
		if !ok {
			t.Errorf("Normalize(%q) reported invalid, want %q", raw, want)
			continue
		}
		if got != want {
			t.Errorf("Normalize(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormalizeInvalid(t *testing.T) {
	cases := []string{
		"12345",
		"0123456",
		"01234567890123",
		"+1 415 555 2671",
		"+6512345678",
		"012-345 678a",
		"020123456",
		"0",
		"+60",
		"1123456789",
	}
	for _, raw := range cases {
		if got, ok := Normalize(raw); ok {
			t.Errorf("Normalize(%q) = %q, want invalid", raw, got)
		}
	}
}
