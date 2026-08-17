package auth

import (
	"errors"
	"regexp"
	"strings"

	"transcendence/modules/geo"
	"transcendence/modules/phone"
	"transcendence/modules/user"
)

var signupPostcodeShape = regexp.MustCompile(`^[0-9]{5}$`)

// validateSignupContact enforces at registration what the profile page enforces
// on every later save: an account always carries a reachable phone number and a
// canonical Malaysian address, because its listings inherit both.
func validateSignupContact(req *user.RegisterRequest) error {
	text := func(value *string) string {
		if value == nil {
			return ""
		}
		trimmed := strings.TrimSpace(*value)
		*value = trimmed
		return trimmed
	}

	rawPhone := text(req.PhoneNo)
	if rawPhone == "" {
		return errors.New("phone number is required")
	}
	normalised, ok := phone.Normalize(rawPhone)
	if !ok || normalised == "" {
		return errors.New("phone number must be a Malaysian number, for example 012-345 6789")
	}
	*req.PhoneNo = normalised

	if text(req.Address) == "" {
		return errors.New("address is required")
	}
	postcode := text(req.Postcode)
	if postcode == "" {
		return errors.New("postcode is required")
	}
	if !signupPostcodeShape.MatchString(postcode) {
		return errors.New("postcode must be 5 digits")
	}

	state, district := text(req.State), text(req.District)
	if state == "" || district == "" {
		return errors.New("state and district are required")
	}
	canonicalState, canonicalDistrict, ok := geo.Resolve(state, district)
	if !ok {
		return errors.New("district must be a Malaysian district within the chosen state")
	}
	*req.State, *req.District = canonicalState, canonicalDistrict

	return nil
}
