package profile

import (
	"errors"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"transcendence/modules/user"
)

// Lengths mirror db/init.sql, except maxBioLen: bio is TEXT there.
const (
	maxEmailLen     = 255
	maxPhoneRawLen  = 30
	maxNameLen      = 50
	maxAddressLen   = 255
	maxBioLen       = 500
	minPhoneDigits  = 8
	maxPhoneDigits  = 15
	earliestBirthYr = 1900
)

var (
	phoneSeparators = regexp.MustCompile(`[\s\-().]`)
	phoneDigits     = regexp.MustCompile(`^\+?[0-9]+$`)
)

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
		if utf8.RuneCountInString(raw) > maxPhoneRawLen {
			errs = append(errs, FieldError{"phoneNo", "phone number is too long"})
		} else {
			normalised := phoneSeparators.ReplaceAllString(raw, "")
			*req.PhoneNo = normalised
			if normalised != "" {
				digits := strings.TrimPrefix(normalised, "+")
				if !phoneDigits.MatchString(normalised) ||
					len(digits) < minPhoneDigits || len(digits) > maxPhoneDigits {
					errs = append(errs, FieldError{
						"phoneNo",
						"phone number must be 8 to 15 digits, optionally starting with +",
					})
				}
			}
		}
	}

	for _, field := range []struct {
		name  string
		value *string
		max   int
	}{
		{"firstName", req.FirstName, maxNameLen},
		{"lastName", req.LastName, maxNameLen},
		{"address", req.Address, maxAddressLen},
		{"bio", req.Bio, maxBioLen},
	} {
		if field.value == nil {
			continue
		}
		*field.value = strings.TrimSpace(*field.value)
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

	if req.DateOfBirth != nil {
		if req.DateOfBirth.After(now) {
			errs = append(errs, FieldError{"dateOfBirth", "date of birth cannot be in the future"})
		} else if req.DateOfBirth.Year() < earliestBirthYr {
			errs = append(errs, FieldError{"dateOfBirth", "date of birth is not valid"})
		}
	}

	return errs
}
