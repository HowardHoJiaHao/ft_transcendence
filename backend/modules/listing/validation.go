package listing

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
)

const maxListingImageSize = 10 * 1024 * 1024

// Shared caps for the caller-supplied listing values. Every write path — the
// sell form, the developer API and the CSV importer — is held to these, and
// db/init.sql carries matching CHECK constraints as the last line of defence.
const (
	maxListingTitleLen       = 70
	maxListingDescriptionLen = 4000
	maxListingPrice          = 100000.0
	maxListingStock          = 100
)

// outOfRangeListingFields reports the caller-supplied values that are present
// but outside their allowed range. Emptiness is missingListingFields' job; this
// only judges what was actually sent.
func OutOfRangeListingFields(item CreateProductRequest) []ListingFieldError {
	var problems []ListingFieldError

	if utf8.RuneCountInString(strings.TrimSpace(item.Title)) > maxListingTitleLen {
		problems = append(problems, ListingFieldError{
			Field:   "title",
			Message: fmt.Sprintf("title must be %d characters or fewer", maxListingTitleLen),
		})
	}
	if utf8.RuneCountInString(item.Description) > maxListingDescriptionLen {
		problems = append(problems, ListingFieldError{
			Field:   "description",
			Message: fmt.Sprintf("description must be %d characters or fewer", maxListingDescriptionLen),
		})
	}
	if item.Price > maxListingPrice {
		problems = append(problems, ListingFieldError{
			Field:   "price",
			Message: fmt.Sprintf("price must not exceed %.0f", maxListingPrice),
		})
	}
	if item.OriginalPrice != nil && *item.OriginalPrice > maxListingPrice {
		problems = append(problems, ListingFieldError{
			Field:   "originalPrice",
			Message: fmt.Sprintf("originalPrice must not exceed %.0f", maxListingPrice),
		})
	}
	if item.StockQuantity != nil && *item.StockQuantity > maxListingStock {
		problems = append(problems, ListingFieldError{
			Field:   "stockQuantity",
			Message: fmt.Sprintf("stockQuantity must not exceed %d", maxListingStock),
		})
	}
	return problems
}

// What Post an Ad pre-selects, mirrored by hand from the useState initialisers
// in sell/page.tsx. Each value is a member of the matching list in
// lib/productOptions.ts — one outside those lists could never match the site's
// own filter chips.
const (
	defaultCategory            = "Others"
	defaultCondition           = "Second-hand (Used)"
	defaultWeightCategory      = "4U"
	defaultFlexibilityCategory = "Medium Flex"
	defaultBalanceCategory     = "Even Balance"
)

// clearNonRacketSpecFields blanks the racket-only specs on any other category,
// so a defaulted "4U" never lands on a listing that is not a racket — that
// would fabricate product data buyers then filter on.
func clearNonRacketSpecFields(category string, weightCategory, flexibilityCategory, balanceCategory *string) {
	if strings.EqualFold(strings.TrimSpace(category), "Rackets") {
		return
	}
	if weightCategory != nil {
		*weightCategory = ""
	}
	if flexibilityCategory != nil {
		*flexibilityCategory = ""
	}
	if balanceCategory != nil {
		*balanceCategory = ""
	}
}

// applyListingDefaults fills what the sell form pre-selects, so the API's
// required set matches the GUI's rather than exceeding it.
//
// location and dealingMethod are deliberately left out: the form pre-selects
// neither, and both are claims nobody made if invented. Bulk import calls this
// too via applyImportDefaults, so a blank CSV cell behaves like a blank field on
// a single-listing POST — both paths require the same four fields.
func ApplyListingDefaults(req *CreateProductRequest) {
	for _, field := range []struct {
		value    *string
		fallback string
	}{
		{&req.Category, defaultCategory},
		{&req.Condition, defaultCondition},
		{&req.WeightCategory, defaultWeightCategory},
		{&req.FlexibilityCategory, defaultFlexibilityCategory},
		{&req.BalanceCategory, defaultBalanceCategory},
	} {
		// TrimSpace so a whitespace-only value defaults too, matching the
		// blank check in missingListingFields that runs straight after.
		if strings.TrimSpace(*field.value) == "" {
			*field.value = field.fallback
		}
	}
	clearNonRacketSpecFields(req.Category, &req.WeightCategory, &req.FlexibilityCategory, &req.BalanceCategory)
}

// missingListingFields reports which caller-owned attributes were left empty.
// It defaults nothing itself: callers run applyListingDefaults first, so only
// dealingMethod can still be reported. Location and phone are no longer here —
// both are inherited from the seller's account rather than sent with a listing.
//
// Shared by createProduct and validateImportRow, so importing 100 listings is
// not a way around a check that creating one would have applied. TrimSpace so a
// CSV cell of only spaces counts as empty.
func MissingListingFields(item CreateProductRequest) []ListingFieldError {
	var missing []ListingFieldError
	if strings.EqualFold(strings.TrimSpace(item.Category), "Rackets") {
		for _, field := range []struct{ name, value string }{
			{"weightCategory", item.WeightCategory},
			{"flexibilityCategory", item.FlexibilityCategory},
			{"balanceCategory", item.BalanceCategory},
		} {
			if strings.TrimSpace(field.value) == "" {
				missing = append(missing, ListingFieldError{
					Field:   field.name,
					Message: field.name + " is required",
				})
			}
		}
	}
	for _, field := range []struct{ name, value string }{
		{"category", item.Category},
		{"condition", item.Condition},
		{"dealingMethod", item.DealingMethod},
	} {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, ListingFieldError{
				Field:   field.name,
				Message: field.name + " is required",
			})
		}
	}
	return missing
}

// Data path: handler → gormDB (wrapping sqlDB) → pgx → PostgreSQL.

// errResponseWritten reports that a helper already wrote the full response.
// Callers must return it immediately; Echo then sees the response as committed.
//
// A sentinel rather than c.JSON's return value, because c.JSON returns nil once
// it has written — so `return c.JSON(400, ...)` yielded a nil error and callers
// ran on past a rejected body, appending a second JSON document and, in
// updateProduct's case, doing the UPDATE anyway.
var errResponseWritten = errors.New("response already written")

func bindStrictJSON(c echo.Context, dest any) error {
	decoder := json.NewDecoder(c.Request().Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(dest)
	if err == nil {
		return nil
	}

	// NOTE: encoding/json saves an unknown-field error and keeps decoding, so
	// `dest` may be fully populated by the time this returns. That is exactly
	// why the caller must abort rather than trust the struct.
	message := "invalid request body"
	if err.Error() == "EOF" {
		message = "Invalid request body"
	} else if idx := strings.Index(err.Error(), "unknown field "); idx >= 0 {
		if name := strings.Trim(err.Error()[idx+len("unknown field "):], "\" "); name != "" {
			message = "invalid field: " + name
		}
	}
	_ = c.JSON(400, map[string]string{"error": message})
	return errResponseWritten
}
