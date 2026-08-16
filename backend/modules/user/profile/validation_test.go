package profile

import (
	"testing"
	"time"

	"transcendence/modules/user"
)

func ptr(s string) *string { return &s }

func fieldsWithErrors(errs []FieldError) map[string]bool {
	out := map[string]bool{}
	for _, e := range errs {
		out[e.Field] = true
	}
	return out
}

func TestValidateProfileUpdateIgnoresAbsentFields(t *testing.T) {
	req := user.UpdateProfileRequest{}
	if errs := validateProfileUpdate(&req, time.Now()); len(errs) > 0 {
		t.Fatalf("expected no errors for an empty request, got %v", errs)
	}
}

func TestValidateProfileUpdateEmail(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name    string
		input   string
		wantErr bool
		want    string // expected normalised value when valid
	}{
		{"plain address", "user@example.com", false, "user@example.com"},
		{"uppercase is lowercased", "User@Example.COM", false, "user@example.com"},
		{"surrounding space is trimmed", "  user@example.com  ", false, "user@example.com"},
		{"no at sign", "not-an-email", true, ""},
		{"empty cannot clear email", "", true, ""},
		{"whitespace only", "   ", true, ""},
		{"missing domain", "user@", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := user.UpdateProfileRequest{Email: ptr(tc.input)}
			errs := validateProfileUpdate(&req, now)
			if tc.wantErr {
				if !fieldsWithErrors(errs)["email"] {
					t.Fatalf("expected an email error for %q, got %v", tc.input, errs)
				}
				return
			}
			if len(errs) > 0 {
				t.Fatalf("expected %q to be valid, got %v", tc.input, errs)
			}
			if *req.Email != tc.want {
				t.Fatalf("expected normalised %q, got %q", tc.want, *req.Email)
			}
		})
	}
}

func TestValidateProfileUpdatePhone(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name    string
		input   string
		wantErr bool
		want    string
	}{
		{"malaysian mobile", "0123456789", false, "0123456789"},
		{"separators are stripped", "012-345 6789", false, "0123456789"},
		{"country code kept", "+60123456789", false, "+60123456789"},
		{"empty clears the field", "", false, ""},
		{"too short", "12345", true, ""},
		{"letters rejected", "0123abc789", true, ""},
		{"too many digits", "1234567890123456", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := user.UpdateProfileRequest{PhoneNo: ptr(tc.input)}
			errs := validateProfileUpdate(&req, now)
			if tc.wantErr {
				if !fieldsWithErrors(errs)["phoneNo"] {
					t.Fatalf("expected a phoneNo error for %q, got %v", tc.input, errs)
				}
				return
			}
			if len(errs) > 0 {
				t.Fatalf("expected %q to be valid, got %v", tc.input, errs)
			}
			if *req.PhoneNo != tc.want {
				t.Fatalf("expected normalised %q, got %q", tc.want, *req.PhoneNo)
			}
		})
	}
}

func TestValidateProfileUpdateGender(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		input   string
		wantErr bool
	}{
		{"Male", false},
		{"Female", false},
		{"", false},
		{"male", true},
		{"Other", true},
		{"'; DROP TABLE users;--", true},
	} {
		req := user.UpdateProfileRequest{Gender: ptr(tc.input)}
		errs := validateProfileUpdate(&req, now)
		if got := fieldsWithErrors(errs)["gender"]; got != tc.wantErr {
			t.Fatalf("gender %q: wanted error=%v, got error=%v (%v)", tc.input, tc.wantErr, got, errs)
		}
	}
}

func TestValidateProfileUpdateLengthCaps(t *testing.T) {
	now := time.Now()
	long := func(n int) *string {
		b := make([]byte, n)
		for i := range b {
			b[i] = 'a'
		}
		return ptr(string(b))
	}

	for _, tc := range []struct {
		field string
		req   user.UpdateProfileRequest
	}{
		{"firstName", user.UpdateProfileRequest{FirstName: long(maxNameLen + 1)}},
		{"lastName", user.UpdateProfileRequest{LastName: long(maxNameLen + 1)}},
		{"address", user.UpdateProfileRequest{Address: long(maxAddressLen + 1)}},
		{"bio", user.UpdateProfileRequest{Bio: long(maxBioLen + 1)}},
	} {
		req := tc.req
		if errs := validateProfileUpdate(&req, now); !fieldsWithErrors(errs)[tc.field] {
			t.Fatalf("expected %s to be rejected for length, got %v", tc.field, errs)
		}
	}

	atCap := user.UpdateProfileRequest{FirstName: long(maxNameLen)}
	if errs := validateProfileUpdate(&atCap, now); len(errs) > 0 {
		t.Fatalf("expected a name of exactly %d to be valid, got %v", maxNameLen, errs)
	}
}

func TestValidateProfileUpdateTrimsFreeText(t *testing.T) {
	req := user.UpdateProfileRequest{
		FirstName: ptr("  Howard  "),
		Bio:       ptr("   "),
	}
	if errs := validateProfileUpdate(&req, time.Now()); len(errs) > 0 {
		t.Fatalf("expected trimming not to produce errors, got %v", errs)
	}
	if *req.FirstName != "Howard" {
		t.Fatalf("expected firstName trimmed to %q, got %q", "Howard", *req.FirstName)
	}
	if *req.Bio != "" {
		t.Fatalf("expected whitespace-only bio to collapse to empty, got %q", *req.Bio)
	}
}

func TestValidateProfileUpdateDateOfBirth(t *testing.T) {
	now := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name    string
		date    time.Time
		wantErr bool
	}{
		{"past date", now.AddDate(-30, 0, 0), false},
		{"today", now, false},
		{"tomorrow", now.AddDate(0, 0, 1), true},
		{"far future", now.AddDate(50, 0, 0), true},
		{"before 1900", time.Date(1899, time.January, 1, 0, 0, 0, 0, time.UTC), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			date := tc.date
			req := user.UpdateProfileRequest{DateOfBirth: &date}
			if got := fieldsWithErrors(validateProfileUpdate(&req, now))["dateOfBirth"]; got != tc.wantErr {
				t.Fatalf("%s: wanted error=%v, got error=%v", tc.name, tc.wantErr, got)
			}
		})
	}
}

func TestValidateProfileUpdateReportsAllProblemsAtOnce(t *testing.T) {
	req := user.UpdateProfileRequest{
		Email:   ptr("nope"),
		PhoneNo: ptr("123"),
		Gender:  ptr("Other"),
	}
	got := fieldsWithErrors(validateProfileUpdate(&req, time.Now()))
	for _, field := range []string{"email", "phoneNo", "gender"} {
		if !got[field] {
			t.Fatalf("expected %s to be reported, got %v", field, got)
		}
	}
}
