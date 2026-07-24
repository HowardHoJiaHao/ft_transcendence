package main

import (
	"slices"
	"testing"
)

func TestValidateImportRow(t *testing.T) {
	validOriginalPrice := 250.0
	validStock := 2
	invalidOriginalPrice := -1.0
	invalidStock := 0

	tests := []struct {
		name       string
		item       CreateProductRequest
		wantFields []string
	}{
		{
			name: "accepts a valid listing",
			item: CreateProductRequest{
				Title:         "Yonex Astrox",
				Price:         200,
				OriginalPrice: &validOriginalPrice,
				StockQuantity: &validStock,
			},
		},
		{
			name: "rejects all invalid monetary and stock fields",
			item: CreateProductRequest{
				Title:         " ",
				Price:         0,
				OriginalPrice: &invalidOriginalPrice,
				StockQuantity: &invalidStock,
			},
			wantFields: []string{"title", "price", "originalPrice", "stockQuantity"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			errors := validateImportRow(7, test.item)
			gotFields := make([]string, 0, len(errors))
			for _, item := range errors {
				if item.Row != 7 {
					t.Fatalf("error row = %d, want 7", item.Row)
				}
				gotFields = append(gotFields, item.Field)
			}

			if !slices.Equal(gotFields, test.wantFields) {
				t.Fatalf("error fields = %v, want %v", gotFields, test.wantFields)
			}
		})
	}
}

func TestApplyImportDefaultsUsesTrustedSellerIdentity(t *testing.T) {
	item := CreateProductRequest{
		SellerID:   999,
		SellerName: "Attacker supplied name",
		Title:      "Valid racket",
		Price:      100,
	}

	applyImportDefaults(&item, 42, "Trusted Seller")

	if item.SellerID != 42 || item.SellerName != "Trusted Seller" {
		t.Fatalf("seller identity = (%d, %q), want (42, %q)", item.SellerID, item.SellerName, "Trusted Seller")
	}
	if item.Location != "Malaysia" ||
		item.WeightCategory != "4U" ||
		item.FlexibilityCategory != "Medium Flex" ||
		item.BalanceCategory != "Even Balance" ||
		item.Category != "Others" ||
		item.Condition != "Second-hand (Used)" ||
		item.DealingMethod != "Meet Up" {
		t.Fatalf("defaults were not applied correctly: %+v", item)
	}
}

func TestApplyImportDefaultsPreservesProvidedListingValues(t *testing.T) {
	item := CreateProductRequest{
		Location:            "Kuala Lumpur",
		WeightCategory:      "3U",
		FlexibilityCategory: "Stiff Shaft",
		BalanceCategory:     "Head Heavy",
		Category:            "Rackets",
		Condition:           "New",
		DealingMethod:       "Delivery",
	}

	applyImportDefaults(&item, 8, "Seller")

	if item.Location != "Kuala Lumpur" ||
		item.WeightCategory != "3U" ||
		item.FlexibilityCategory != "Stiff Shaft" ||
		item.BalanceCategory != "Head Heavy" ||
		item.Category != "Rackets" ||
		item.Condition != "New" ||
		item.DealingMethod != "Delivery" {
		t.Fatalf("provided listing values were overwritten: %+v", item)
	}
}
