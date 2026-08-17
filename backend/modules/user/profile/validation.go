package profile

import (
	"errors"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"transcendence/modules/geo"
	"transcendence/modules/phone"
	"transcendence/modules/user"
)

// Lengths mirror db/init.sql, except maxBioLen: bio is TEXT there.
const (
	maxEmailLen     = 255
	maxPhoneRawLen  = 30
	maxNameLen      = 50
	maxAddressLen   = 255
	maxBioLen       = 500
	earliestBirthYr = 1900
)

var postcodeShape = regexp.MustCompile(`^[0-9]{5}$`)

type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func isUniqueViolation(err error) bool {
	var pgError *pgconn.PgError
	return errors.As(err, &pgError) && pgError.Code == "23505"
}

// validateProfileUpdate checks and normalises in place, returning every
// problem found. A nil field means "not sent"; a pointer to "" means "clear".
func validateProfileUpdate(req *user.UpdateProfileRequest, now time.Time) []FieldError {
	var errs []FieldError

	// email cannot be cleared: the column is NOT NULL UNIQUE.
	if req.Email != nil {
		normalised := strings.ToLower(strings.TrimSpace(*req.Email))
		*req.Email = normalised
		switch {
		case normalised == "":
			errs = append(errs, FieldError{"email", "email is required"})
		case utf8.RuneCountInString(normalised) > maxEmailLen:
			errs = append(errs, FieldError{"email", "email is too long"})
		default:
			if _, err := mail.ParseAddress(normalised); err != nil {
				errs = append(errs, FieldError{"email", "email is not a valid address"})
			}
		}
	}

	if req.PhoneNo != nil {
		raw := strings.TrimSpace(*req.PhoneNo)
		switch {
		case raw == "":
			errs = append(errs, FieldError{"phoneNo", "phone number is required"})
		case utf8.RuneCountInString(raw) > maxPhoneRawLen:
			errs = append(errs, FieldError{"phoneNo", "phone number is too long"})
		default:
			if normalised, ok := phone.Normalize(raw); ok {
				*req.PhoneNo = normalised
			} else {
				errs = append(errs, FieldError{
					"phoneNo",
					"phone number must be a Malaysian number, for example 012-345 6789",
				})
			}
		}
	}

	for _, field := range []struct {
		name     string
		value    *string
		max      int
		required bool
	}{
		{"firstName", req.FirstName, maxNameLen, false},
		{"lastName", req.LastName, maxNameLen, false},
		{"address", req.Address, maxAddressLen, true},
		{"bio", req.Bio, maxBioLen, false},
	} {
		if field.value == nil {
			continue
		}
		*field.value = strings.TrimSpace(*field.value)
		if field.required && *field.value == "" {
			errs = append(errs, FieldError{field.name, field.name + " is required"})
			continue
		}
		if utf8.RuneCountInString(*field.value) > field.max {
			errs = append(errs, FieldError{field.name, field.name + " is too long"})
		}
	}

	// "" is allowed; the repository stores it as NULL, which the column's
	// CHECK (gender IN ('Male','Female')) permits but an empty string does not.
	if req.Gender != nil {
		*req.Gender = strings.TrimSpace(*req.Gender)
		if *req.Gender != "" && *req.Gender != "Male" && *req.Gender != "Female" {
			errs = append(errs, FieldError{"gender", "gender must be Male or Female"})
		}
	}

	if req.Postcode != nil {
		*req.Postcode = strings.TrimSpace(*req.Postcode)
		if *req.Postcode == "" {
			errs = append(errs, FieldError{"postcode", "postcode is required"})
		} else if !postcodeShape.MatchString(*req.Postcode) {
			errs = append(errs, FieldError{"postcode", "postcode must be 5 digits"})
		}
	}

	errs = append(errs, validateStateDistrict(req)...)

	if req.DateOfBirth != nil {
		if req.DateOfBirth.After(now) {
			errs = append(errs, FieldError{"dateOfBirth", "date of birth cannot be in the future"})
		} else if req.DateOfBirth.Year() < earliestBirthYr {
			errs = append(errs, FieldError{"dateOfBirth", "date of birth is not valid"})
		}
	}

	return errs
}

// State and district are validated as a pair and rewritten to canonical spelling.
func validateStateDistrict(req *user.UpdateProfileRequest) []FieldError {
	if req.State == nil && req.District == nil {
		return nil
	}
	if req.State == nil || req.District == nil {
		return []FieldError{{"state", "state and district must be sent together"}}
	}

	state := strings.TrimSpace(*req.State)
	district := strings.TrimSpace(*req.District)
	if state == "" || district == "" {
		return []FieldError{{"state", "state and district are required"}}
	}

	canonicalState, canonicalDistrict, ok := geo.Resolve(state, district)
	if !ok {
		return []FieldError{{"district", "district must be a Malaysian district within the chosen state"}}
	}
	*req.State, *req.District = canonicalState, canonicalDistrict
	return nil
}
