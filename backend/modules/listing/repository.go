package listing

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

func gormNoTx(db *gorm.DB) *gorm.DB {
	return db.Session(&gorm.Session{SkipDefaultTransaction: true})
}

// get username for user id
func lookupUsername(db *gorm.DB, userID int) (string, error) {
	var row usernameRow
	err := db.Select("username").First(&row, userID).Error
	return row.Username, err
}

func LookupSellerProfile(db *gorm.DB, userID int) (SellerProfile, error) {
	var row sellerProfileRow
	err := db.Select("username", "phone_no", "address", "postcode", "state", "district").
		First(&row, userID).Error
	if err != nil {
		return SellerProfile{}, err
	}
	text := func(value *string) string {
		if value == nil {
			return ""
		}
		return strings.TrimSpace(*value)
	}
	return SellerProfile{
		Username: row.Username,
		PhoneNo:  text(row.PhoneNo),
		Address:  text(row.Address),
		Postcode: text(row.Postcode),
		State:    text(row.State),
		District: text(row.District),
	}, nil
}

const IncompleteProfileError = "Add your phone number and address to your profile before posting an ad"

// who owns this listing
func loadListingSellerID(db *gorm.DB, listingID int) (int, error) {
	var row listingRow
	err := db.Select("seller_id").First(&row, listingID).Error
	return row.SellerID, err
}

// owner + stock
func loadListingSellerAndStock(db *gorm.DB, listingID int) (int, int, error) {
	var row listingRow
	err := db.Select("seller_id", "stock_quantity").First(&row, listingID).Error
	return row.SellerID, row.StockQuantity, err
}

// loadListingSellerAndStatus reads the two things the delete path needs in one
// round trip: who owns the listing, and whether its state allows deletion.
//
// status is COALESCEd because the column is nullable on rows created before it
// existed, and listingRow.Status is a plain string that cannot scan a NULL.
func loadListingSellerAndStatus(db *gorm.DB, listingID int) (int, string, error) {
	var row listingRow
	err := db.Select("seller_id, COALESCE(status, 'active') AS status").First(&row, listingID).Error
	return row.SellerID, row.Status, err
}

// insert one listing
func createListingRow(db *gorm.DB, row *listingRow) error {
	return gormNoTx(db).Select(
		"SellerID", "Title", "Description", "WeightCategory", "FlexibilityCategory",
		"BalanceCategory", "Price", "OriginalPrice", "Location", "State", "Image", "SellerName",
		"IsNew", "IsFeatured", "Status", "Category", "Condition", "DealingMethod",
		"StockQuantity",
	).Create(row).Error
}

// delete the listing
func deleteListingByID(db *gorm.DB, id int) error {
	return gormNoTx(db).Delete(&listingRow{}, id).Error
}

// update some columns
func updateListingColumns(db *gorm.DB, id int, fields map[string]interface{}) error {
	return gormNoTx(db).Model(&listingRow{}).Where("id = ?", id).Updates(fields).Error
}

// listingSelectCols is the shared SELECT column list for all product queries.
//
// Rating, review count and seller name are derived rather than read from the
// like-named listings columns: nothing maintains those, so they served stale
// values. listing_reviews and the users row are the sources of truth.
const listingSelectCols = `l.id, l.title, l.price, l.original_price, COALESCE(l.image, ''),
	COALESCE(l.category, 'Others'), COALESCE(l.condition, 'Second-hand (Used)'),
	COALESCE(l.dealing_method, ''), COALESCE(u.phone_no, ''),
	COALESCE(l.weight_category, ''), COALESCE(l.flexibility_category, ''), COALESCE(l.balance_category, ''),
	COALESCE(l.location, ''), COALESCE(l.state, ''), l.seller_id, COALESCE(u.username, l.seller_name, ''), COALESCE(u.avatar_url, ''),
	ROUND(COALESCE(lr.avg_rating, 0), 1)::float8, COALESCE(lr.review_count, 0),
	l.is_new, l.is_featured,
	COALESCE(l.stock_quantity, 0), COALESCE(l.status, 'active'), COALESCE(l.views_count, 0),
	l.created_at, COALESCE(l.description, '')`

// listingFromClause pairs every listing with its seller and its live review
// aggregate. Kept next to listingSelectCols because the two must stay in step:
// the select list references u and lr.
//
// The review aggregate is a LEFT JOINed subquery rather than a correlated
// scalar subselect, so a listing with no reviews still appears — it just
// arrives with NULLs the COALESCEs turn into zeroes.
const listingFromClause = ` FROM listings l
	LEFT JOIN users u ON l.seller_id = u.id
	LEFT JOIN (
		SELECT listing_id, COUNT(*) AS review_count, AVG(rating) AS avg_rating
		FROM listing_reviews
		GROUP BY listing_id
	) lr ON lr.listing_id = l.id`

// turn sql rows into []Product for getProducts
func scanProducts(rows *sql.Rows) ([]Product, error) {
	products := []Product{}
	for rows.Next() {
		var p Product
		err := rows.Scan(
			&p.ID, &p.Title, &p.Price, &p.OriginalPrice, &p.Image,
			&p.Category, &p.Condition, &p.DealingMethod, &p.PhoneNumber,
			&p.WeightCategory, &p.FlexibilityCategory, &p.BalanceCategory,
			&p.Location, &p.State, &p.SellerId, &p.SellerName, &p.SellerAvatar, &p.Rating, &p.Reviews,
			&p.IsNew, &p.IsFeatured, &p.StockQuantity, &p.Status, &p.ViewsCount, &p.CreatedAt, &p.Description,
		)
		if err != nil {
			log.Printf("Error scanning product: %v", err)
			continue
		}
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return products, nil
}

// +1 view, unless the seller is viewing their own listing
func recordListingView(sqlDB *sql.DB, listingID int, sellerID int, c echo.Context) {
	viewerID, err := extractUserID(c)
	if err == nil && viewerID == sellerID {
		return
	}

	if _, err := sqlDB.Exec(
		"UPDATE listings SET views_count = views_count + 1 WHERE id = $1", listingID,
	); err != nil {
		log.Printf("Error incrementing views_count for listing %d: %v", listingID, err)
	}
}

func fetchProductByID(sqlDB *sql.DB, id int) (Product, error) {
	query := "SELECT " + listingSelectCols + listingFromClause + " WHERE l.id = $1"
	var p Product
	err := sqlDB.QueryRow(query, id).Scan(
		&p.ID, &p.Title, &p.Price, &p.OriginalPrice, &p.Image,
		&p.Category, &p.Condition, &p.DealingMethod, &p.PhoneNumber,
		&p.WeightCategory, &p.FlexibilityCategory, &p.BalanceCategory,
		&p.Location, &p.State, &p.SellerId, &p.SellerName, &p.SellerAvatar, &p.Rating, &p.Reviews,
		&p.IsNew, &p.IsFeatured, &p.StockQuantity, &p.Status, &p.ViewsCount, &p.CreatedAt, &p.Description,
	)
	return p, err
}

// extractUserID pulls the numeric user ID from the "Bearer token_<id>" auth header.
func extractUserID(c echo.Context) (int, error) {
	auth := c.Request().Header.Get("Authorization")
	if auth == "" || !strings.HasPrefix(auth, "Bearer token_") {
		return 0, fmt.Errorf("Unauthorized")
	}
	return strconv.Atoi(strings.TrimPrefix(auth, "Bearer token_"))
}
