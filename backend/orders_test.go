package main

import "testing"

func TestIsValidOrderStatusUsesStrictAllowlist(t *testing.T) {
	valid := []string{"pending", "completed", "cancelled", "refunded"}
	for _, status := range valid {
		if !isValidOrderStatus(status) {
			t.Errorf("expected %q to be accepted", status)
		}
	}

	invalid := []string{
		"",
		"shipped",
		"COMPLETED",
		"completed ",
		"completed; DROP TABLE orders;",
	}
	for _, status := range invalid {
		if isValidOrderStatus(status) {
			t.Errorf("expected %q to be rejected", status)
		}
	}
}
