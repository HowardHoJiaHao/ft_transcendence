package auth

import (
	"regexp"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserId int `json:"user_id"`
	jwt.RegisteredClaims
}

type PasswordRule struct {
	Pattern *regexp.Regexp
	Message string
}

type PasswordChecker struct {
	MinLength     int
	Rules         []PasswordRule
	CheckUsername bool
}

type googleUserResponse struct {
    ID         string `json:"id"`
    Email      string `json:"email"`
    Name       string `json:"name"`
	GivenName  string `json:"given_name"`
	FamilyName string `json:"family_name"`
    Picture    string `json:"picture"`
}
