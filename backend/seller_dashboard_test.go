package main

import (
	"testing"
	"time"
)

// Fixed reference point so the trailing-window defaults are deterministic.
var refNow = time.Date(2026, 8, 3, 14, 30, 0, 0, time.UTC)

func TestResolveReportRangeDefaultsToTrailingTwelveMonths(t *testing.T) {
	from, to, err := resolveReportRange("", "", "", refNow)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 12 months ending in Aug 2026 starts at the first of Sep 2025.
	want := time.Date(2025, 9, 1, 0, 0, 0, 0, time.UTC)
	if !from.Equal(want) {
		t.Errorf("from = %v, want %v", from, want)
	}
	if !to.Equal(refNow) {
		t.Errorf("to = %v, want %v", to, refNow)
	}
}

func TestResolveReportRangeHonoursMonthsParam(t *testing.T) {
	from, _, err := resolveReportRange("3", "", "", refNow)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	if !from.Equal(want) {
		t.Errorf("from = %v, want %v", from, want)
	}
}

func TestResolveReportRangeRejectsOutOfBoundsMonths(t *testing.T) {
	// Out-of-range or unparseable months fall back to the 12-month default
	// rather than erroring, matching the pre-existing behaviour.
	for _, m := range []string{"0", "-1", "999", "abc"} {
		from, _, err := resolveReportRange(m, "", "", refNow)
		if err != nil {
			t.Fatalf("months=%q: unexpected error: %v", m, err)
		}
		want := time.Date(2025, 9, 1, 0, 0, 0, 0, time.UTC)
		if !from.Equal(want) {
			t.Errorf("months=%q: from = %v, want default %v", m, from, want)
		}
	}
}

// The headline requirement: an explicit "1 Jan – 31 Mar" style window.
func TestResolveReportRangeCustomRangeIsInclusive(t *testing.T) {
	from, to, err := resolveReportRange("", "2026-01-01", "2026-03-31", refNow)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	wantFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if !from.Equal(wantFrom) {
		t.Errorf("from = %v, want %v", from, wantFrom)
	}
	// An order placed at 23:59 on 31 Mar must fall inside the window.
	lateOnLastDay := time.Date(2026, 3, 31, 23, 59, 59, 0, time.UTC)
	if to.Before(lateOnLastDay) {
		t.Errorf("to = %v excludes %v; end date must be inclusive", to, lateOnLastDay)
	}
	// ...but 1 Apr must not.
	nextDay := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	if !to.Before(nextDay) {
		t.Errorf("to = %v must not reach into %v", to, nextDay)
	}
}

func TestResolveReportRangeCustomRangeOverridesMonths(t *testing.T) {
	from, _, err := resolveReportRange("6", "2026-01-01", "", refNow)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if !from.Equal(want) {
		t.Errorf("explicit from should win over months: got %v, want %v", from, want)
	}
}

func TestResolveReportRangeAcceptsOneSidedBounds(t *testing.T) {
	// Only `to` supplied: `from` keeps the trailing-window default.
	from, to, err := resolveReportRange("", "", "2026-02-28", refNow)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	wantFrom := time.Date(2025, 9, 1, 0, 0, 0, 0, time.UTC)
	if !from.Equal(wantFrom) {
		t.Errorf("from = %v, want default %v", from, wantFrom)
	}
	if to.Before(time.Date(2026, 2, 28, 23, 0, 0, 0, time.UTC)) {
		t.Errorf("to = %v should cover all of 28 Feb", to)
	}
}

func TestResolveReportRangeRejectsMalformedDates(t *testing.T) {
	for _, tc := range []struct{ from, to string }{
		{"01-01-2026", ""},
		{"", "31/03/2026"},
		{"not-a-date", ""},
		{"2026-13-01", ""}, // month 13 does not exist
	} {
		if _, _, err := resolveReportRange("", tc.from, tc.to, refNow); err == nil {
			t.Errorf("from=%q to=%q: expected an error, got none", tc.from, tc.to)
		}
	}
}

func TestResolveReportRangeRejectsInvertedRange(t *testing.T) {
	_, _, err := resolveReportRange("", "2026-03-31", "2026-01-01", refNow)
	if err == nil {
		t.Fatal("expected an error when 'from' is after 'to'")
	}
}

func soldRow(category string, id int, days, revenue float64) categorySoldRow {
	return categorySoldRow{
		Category: category,
		CategorySoldItem: CategorySoldItem{
			ListingID: id, Title: "item", SoldAt: "2026-01-14",
			DaysToSell: days, Revenue: revenue,
		},
	}
}

// The whole reason this endpoint exists: a group's totals must be derivable
// from the rows it carries, so expanding it can never contradict the row above.
func TestGroupByCategoryDerivesTotalsFromItsOwnItems(t *testing.T) {
	got := groupByCategory([]categorySoldRow{
		soldRow("Rackets", 10, 12, 50),
		soldRow("Footwear", 17, 4, 240),
		soldRow("Rackets", 23, 18, 300),
	})

	if len(got) != 2 {
		t.Fatalf("got %d categories, want 2: %#v", len(got), got)
	}
	rackets := got[0]
	if rackets.Category != "Rackets" {
		t.Fatalf("highest revenue category = %q, want Rackets", rackets.Category)
	}
	if rackets.ItemsSold != len(rackets.Items) {
		t.Errorf("itemsSold = %d but carries %d items", rackets.ItemsSold, len(rackets.Items))
	}

	var revenue, days float64
	for _, item := range rackets.Items {
		revenue += item.Revenue
		days += item.DaysToSell
	}
	if rackets.Revenue != revenue {
		t.Errorf("revenue = %v, want %v (the sum of its items)", rackets.Revenue, revenue)
	}
	if want := days / float64(len(rackets.Items)); rackets.AvgDaysToSell != want {
		t.Errorf("avgDaysToSell = %v, want %v (the mean of its items)", rackets.AvgDaysToSell, want)
	}
	if rackets.AvgDaysToSell != 15 {
		t.Errorf("avgDaysToSell = %v, want 15", rackets.AvgDaysToSell)
	}
}

// Equal revenue must not leave the order up to Go's randomised map iteration,
// or the category table would reshuffle between identical requests.
func TestGroupByCategoryBreaksRevenueTiesByName(t *testing.T) {
	rows := []categorySoldRow{
		soldRow("Rackets", 10, 5, 100),
		soldRow("Apparel", 11, 5, 100),
		soldRow("Bags", 12, 5, 100),
	}
	for i := 0; i < 20; i++ {
		got := groupByCategory(rows)
		if got[0].Category != "Apparel" ||
			got[1].Category != "Bags" ||
			got[2].Category != "Rackets" {
			t.Fatalf("unstable tie order on run %d: %#v", i, got)
		}
	}
}

func TestGroupByCategoryOnNoRowsIsEmptyNotNil(t *testing.T) {
	got := groupByCategory(nil)
	if got == nil {
		t.Fatal("got nil, want an empty slice so the JSON is [] rather than null")
	}
	if len(got) != 0 {
		t.Fatalf("got %#v, want no categories", got)
	}
}
