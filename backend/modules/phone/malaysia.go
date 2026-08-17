package phone

import (
	"regexp"
	"strings"
)

const MaxRawLen = 30

var (
	separators = regexp.MustCompile(`[\s\-().]`)
	digitsOnly = regexp.MustCompile(`^[0-9]+$`)
)

// nsnLen maps a national significant number prefix to its required total length.
var nsnLen = map[string]int{
	"11": 10, "15": 10,
	"10": 9, "12": 9, "13": 9, "14": 9, "16": 9, "17": 9, "18": 9, "19": 9,
	"3": 9,
	"4": 8, "5": 8, "6": 8, "7": 8, "8": 8, "9": 8,
}

// Normalize converts a Malaysian number to +60 form, reporting whether it is valid.
func Normalize(raw string) (string, bool) {
	compact := separators.ReplaceAllString(strings.TrimSpace(raw), "")
	if compact == "" {
		return "", true
	}

	var nsn string
	switch {
	case strings.HasPrefix(compact, "+60"):
		nsn = compact[3:]
	case strings.HasPrefix(compact, "60"):
		nsn = compact[2:]
	case strings.HasPrefix(compact, "0"):
		nsn = compact[1:]
	default:
		return "", false
	}

	if !digitsOnly.MatchString(nsn) {
		return "", false
	}
	if want, ok := nsnLen[nsn[:min(2, len(nsn))]]; ok && len(nsn) == want {
		return "+60" + nsn, true
	}
	if want, ok := nsnLen[nsn[:min(1, len(nsn))]]; ok && len(nsn) == want {
		return "+60" + nsn, true
	}
	return "", false
}

func IsValid(raw string) bool {
	_, ok := Normalize(raw)
	return ok
}
