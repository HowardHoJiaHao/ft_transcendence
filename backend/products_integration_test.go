//go:build integration

package main

// Integration checks for the merge resolution, run against the REAL Postgres in
// the Compose stack rather than sqlmock.
//
// WHY THIS EXISTS: sqlmock matches SQL with a regex — it never asks Postgres
// whether the statement is valid. The merge moved several queries onto GORM,
// including loadListingSellerAndStatus, which passes a raw expression
// ("COALESCE(status, 'active') AS status") through GORM's Select. A mock will
// happily accept SQL the database would reject, so the unit suite cannot prove
// Waikeong's raw-SQL-to-GORM conversion actually works.
//
//	go test -tags=integration -run TestMerge -v .

import (
	"bytes"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func integrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	pw := os.Getenv("PGPASSWORD")
	if pw == "" {
		t.Skip("PGPASSWORD not set")
	}
	dsn := fmt.Sprintf(
		"host=127.0.0.1 port=5432 user=transcendence password=%s dbname=transcendence sslmode=disable",
		pw,
	)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return db
}

// seedListing creates a throwaway seller + listing and removes both afterwards,
// so the test leaves the developer's database exactly as it found it.
func seedListing(t *testing.T, db *gorm.DB, status string, stock int) (sellerID, listingID int) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	if err := sqlDB.QueryRow(
		`INSERT INTO users (username, email, password_hash)
		 VALUES ('zz_merge_probe', 'zz_merge_probe@example.test', 'x')
		 RETURNING id`,
	).Scan(&sellerID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := sqlDB.QueryRow(
		`INSERT INTO listings (seller_id, title, description, price, location, category,
			condition, dealing_method, phone_number, weight_category, flexibility_category,
			balance_category, status, stock_quantity, seller_name, image)
		 VALUES ($1,'zz probe','desc',100,'Kuala Lumpur','Rackets','New','Meet Up','012',
			'4U','Medium Flex','Even Balance',$2,$3,'zz_merge_probe','')
		 RETURNING id`, sellerID, status, stock,
	).Scan(&listingID); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	t.Cleanup(func() {
		sqlDB.Exec("DELETE FROM listings WHERE id = $1", listingID)
		sqlDB.Exec("DELETE FROM users WHERE id = $1", sellerID)
	})
	return sellerID, listingID
}

func putJSON(t *testing.T, id, userID int, body string) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/products/"+fmt.Sprint(id), bytes.NewBufferString(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprint(id))
	c.Set("userId", userID)
	return c, rec
}

func fullBody(title, status string, price int) string {
	return fmt.Sprintf(`{"title":%q,"price":%d,"description":"desc","category":"Rackets",`+
		`"condition":"New","dealingMethod":"Meet Up","phoneNumber":"012","originalPrice":null,`+
		`"stockQuantity":1,"location":"Kuala Lumpur","weightCategory":"4U",`+
		`"flexibilityCategory":"Medium Flex","balanceCategory":"Even Balance","status":%q}`,
		title, price, status)
}

// The conversion Waikeong's commit performed, exercised against real Postgres.
func TestMergeGormHelpersRunAgainstPostgres(t *testing.T) {
	db := integrationDB(t)
	sellerID, listingID := seedListing(t, db, "active", 3)

	t.Run("lookupUsername", func(t *testing.T) {
		name, err := lookupUsername(db, sellerID)
		if err != nil {
			t.Fatalf("lookupUsername: %v", err)
		}
		if name != "zz_merge_probe" {
			t.Fatalf("username = %q", name)
		}
	})

	t.Run("loadListingSellerID", func(t *testing.T) {
		got, err := loadListingSellerID(db, listingID)
		if err != nil {
			t.Fatalf("loadListingSellerID: %v", err)
		}
		if got != sellerID {
			t.Fatalf("sellerID = %d, want %d", got, sellerID)
		}
	})

	t.Run("loadListingSellerAndStock", func(t *testing.T) {
		s, stock, err := loadListingSellerAndStock(db, listingID)
		if err != nil {
			t.Fatalf("loadListingSellerAndStock: %v", err)
		}
		if s != sellerID || stock != 3 {
			t.Fatalf("got (%d,%d), want (%d,3)", s, stock, sellerID)
		}
	})

	// The helper added during conflict 4. Its Select carries a COALESCE
	// expression, which is exactly the shape a mock cannot validate.
	t.Run("loadListingSellerAndStatus", func(t *testing.T) {
		s, status, err := loadListingSellerAndStatus(db, listingID)
		if err != nil {
			t.Fatalf("loadListingSellerAndStatus: %v", err)
		}
		if s != sellerID || status != "active" {
			t.Fatalf("got (%d,%q), want (%d,\"active\")", s, status, sellerID)
		}
	})

	t.Run("updateListingColumns", func(t *testing.T) {
		if err := updateListingColumns(db, listingID, map[string]interface{}{
			"title":      "zz probe renamed",
			"updated_at": gorm.Expr("CURRENT_TIMESTAMP"),
		}); err != nil {
			t.Fatalf("updateListingColumns: %v", err)
		}
		sqlDB, _ := db.DB()
		var got string
		if err := sqlDB.QueryRow("SELECT title FROM listings WHERE id=$1", listingID).Scan(&got); err != nil {
			t.Fatalf("read back: %v", err)
		}
		if got != "zz probe renamed" {
			t.Fatalf("title = %q", got)
		}
	})

	t.Run("createListingRow and deleteListingByID", func(t *testing.T) {
		row := listingRow{
			SellerID: sellerID, Title: "zz probe two", Description: "d",
			WeightCategory: "4U", FlexibilityCategory: "Medium Flex", BalanceCategory: "Even Balance",
			Category: "Rackets", Condition: "New", DealingMethod: "Meet Up", PhoneNumber: "012",
			Price: 50, Location: "Penang", Image: "", SellerName: "zz_merge_probe",
			StockQuantity: 1, Status: "active",
		}
		if err := createListingRow(db, &row); err != nil {
			t.Fatalf("createListingRow: %v", err)
		}
		if row.ID == 0 {
			t.Fatal("createListingRow did not populate the id")
		}
		if err := deleteListingByID(db, row.ID); err != nil {
			t.Fatalf("deleteListingByID: %v", err)
		}
	})
}

// The behaviour decided in conflict 6, end to end against Postgres.
func TestMergeStatusRulesAgainstPostgres(t *testing.T) {
	db := integrationDB(t)
	sqlDB, _ := db.DB()

	readStatus := func(id int) string {
		var s sql.NullString
		if err := sqlDB.QueryRow("SELECT status FROM listings WHERE id=$1", id).Scan(&s); err != nil {
			t.Fatalf("read status: %v", err)
		}
		return s.String
	}

	t.Run("archive is honoured", func(t *testing.T) {
		sellerID, id := seedListing(t, db, "active", 1)
		c, rec := putJSON(t, id, sellerID, fullBody("zz probe", "archived", 120))
		expectHandled(t, updateProduct(c, db))
		if rec.Code != 200 {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if got := readStatus(id); got != "archived" {
			t.Fatalf("listing status = %q, want archived", got)
		}
	})

	t.Run("republish is honoured", func(t *testing.T) {
		sellerID, id := seedListing(t, db, "archived", 1)
		c, rec := putJSON(t, id, sellerID, fullBody("zz probe", "active", 120))
		expectHandled(t, updateProduct(c, db))
		if rec.Code != 200 {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if got := readStatus(id); got != "active" {
			t.Fatalf("listing status = %q, want active", got)
		}
	})

	t.Run("order-flow status refused", func(t *testing.T) {
		sellerID, id := seedListing(t, db, "active", 1)
		c, rec := putJSON(t, id, sellerID, fullBody("zz probe", "sold", 120))
		expectHandled(t, updateProduct(c, db))
		if rec.Code != 400 {
			t.Fatalf("status = %d, want 400; body = %s", rec.Code, rec.Body.String())
		}
		if got := readStatus(id); got != "active" {
			t.Fatalf("listing status = %q, want it untouched", got)
		}
	})

	t.Run("republish with zero stock becomes sold", func(t *testing.T) {
		sellerID, id := seedListing(t, db, "archived", 0)
		body := fullBody("zz probe", "active", 120)
		// stockQuantity 0 in the payload, matching an out-of-stock listing.
		body = bytes.NewBuffer([]byte(body)).String()
		body = replaceOnce(body, `"stockQuantity":1`, `"stockQuantity":0`)
		c, rec := putJSON(t, id, sellerID, body)
		expectHandled(t, updateProduct(c, db))
		if rec.Code != 200 {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if got := readStatus(id); got != "sold" {
			t.Fatalf("listing status = %q, want sold", got)
		}
	})

	t.Run("editing a pending listing is refused", func(t *testing.T) {
		sellerID, id := seedListing(t, db, "pending", 1)
		c, rec := putJSON(t, id, sellerID, fullBody("zz probe", "active", 120))
		expectHandled(t, updateProduct(c, db))
		if rec.Code != 409 {
			t.Fatalf("status = %d, want 409; body = %s", rec.Code, rec.Body.String())
		}
	})
}

func replaceOnce(s, old, new string) string {
	i := bytes.Index([]byte(s), []byte(old))
	if i < 0 {
		return s
	}
	return s[:i] + new + s[i+len(old):]
}
