package listing

import (
	"time"
)

type Product struct {
	ID                  int       `json:"id"`
	Title               string    `json:"title"`
	Price               float64   `json:"price"`
	OriginalPrice       *float64  `json:"originalPrice,omitempty"`
	Image               string    `json:"image"`
	Category            string    `json:"category"`
	Condition           string    `json:"condition"`
	DealingMethod       string    `json:"dealingMethod"`
	PhoneNumber         string    `json:"phoneNumber"`
	WeightCategory      string    `json:"weightCategory"`
	FlexibilityCategory string    `json:"flexibilityCategory"`
	BalanceCategory     string    `json:"balanceCategory"`
	Location            string    `json:"location"`
	State               string    `json:"state"`
	SellerId            int       `json:"sellerId"`
	SellerName          string    `json:"sellerName"`
	SellerAvatar        string    `json:"sellerAvatar"`
	Rating              float64   `json:"rating"`
	Reviews             int       `json:"reviews"`
	IsNew               bool      `json:"-"`
	IsFeatured          bool      `json:"-"`
	StockQuantity       int       `json:"stockQuantity"`
	Status              string    `json:"status"`
	ViewsCount          int       `json:"viewsCount"`
	CreatedAt           time.Time `json:"createdAt"`
	Description         string    `json:"description"`
}

type CreateProductRequest struct {
	SellerID            int      `json:"sellerId"`
	SellerName          string   `json:"sellerName"`
	Category            string   `json:"category"`
	Condition           string   `json:"condition"`
	DealingMethod       string   `json:"dealingMethod"`
	Title               string   `json:"title"`
	Description         string   `json:"description"`
	WeightCategory      string   `json:"weightCategory"`
	FlexibilityCategory string   `json:"flexibilityCategory"`
	BalanceCategory     string   `json:"balanceCategory"`
	Price               float64  `json:"price"`
	OriginalPrice       *float64 `json:"originalPrice,omitempty"`
	Location            string   `json:"location"`
	State               string   `json:"state"`
	Image               string   `json:"image"`
	IsNew               bool     `json:"isNew"`
	IsFeatured          bool     `json:"isFeatured"`
	StockQuantity       *int     `json:"stockQuantity,omitempty"`
}

type UpdateProductRequest struct {
	Title         *string  `json:"title"`
	Price         *float64 `json:"price"`
	Description   *string  `json:"description"`
	Category      *string  `json:"category"`
	Location      *string  `json:"location"`
	State         *string  `json:"state"`
	StockQuantity *int     `json:"stockQuantity,omitempty"`
}

// listingRow is the listings table for GORM. Product stays the API/read model
// (joins and derived rating) and is not used for inserts.
type listingRow struct {
	ID                  int      `gorm:"primaryKey"`
	SellerID            int      `gorm:"column:seller_id"`
	Title               string   `gorm:"column:title"`
	Description         string   `gorm:"column:description"`
	WeightCategory      string   `gorm:"column:weight_category"`
	FlexibilityCategory string   `gorm:"column:flexibility_category"`
	BalanceCategory     string   `gorm:"column:balance_category"`
	Category            string   `gorm:"column:category"`
	Condition           string   `gorm:"column:condition"`
	DealingMethod       string   `gorm:"column:dealing_method"`
	PhoneNumber         string   `gorm:"column:phone_number"`
	Price               float64  `gorm:"column:price"`
	OriginalPrice       *float64 `gorm:"column:original_price"`
	Location            string   `gorm:"column:location"`
	State               string   `gorm:"column:state"`
	Image               string   `gorm:"column:image"`
	SellerName          string   `gorm:"column:seller_name"`
	IsNew               bool     `gorm:"column:is_new"`
	IsFeatured          bool     `gorm:"column:is_featured"`
	StockQuantity       int      `gorm:"column:stock_quantity"`
	Status              string   `gorm:"column:status"`
}

func (listingRow) TableName() string { return "listings" }

type usernameRow struct {
	ID       int    `gorm:"primaryKey"`
	Username string `gorm:"column:username"`
}

func (usernameRow) TableName() string { return "users" }

type sellerProfileRow struct {
	ID       int     `gorm:"primaryKey"`
	Username string  `gorm:"column:username"`
	PhoneNo  *string `gorm:"column:phone_no"`
	Address  *string `gorm:"column:address"`
	Postcode *string `gorm:"column:postcode"`
	State    *string `gorm:"column:state"`
	District *string `gorm:"column:district"`
}

func (sellerProfileRow) TableName() string { return "users" }

// sellerProfile is the account data a listing inherits instead of asking for.
type SellerProfile struct {
	Username string
	PhoneNo  string
	Address  string
	Postcode string
	State    string
	District string
}

// A listing carries its seller's contact and location, so a profile missing
// either cannot produce one.
func (p SellerProfile) Incomplete() bool {
	return p.PhoneNo == "" || p.Address == "" || p.Postcode == "" ||
		p.State == "" || p.District == ""
}

// listingFieldError names a listing attribute the caller failed to supply.
type ListingFieldError struct {
	Field   string
	Message string
}

// currentListing is a row's pre-edit state. The API-key path overlays its six
// patchable fields onto it; the JWT path replaces the row outright and needs
// only SellerID and Status from it.
type currentListing struct {
	SellerID            int
	Status              string
	Title               string
	Description         string
	Category            string
	Location            string
	WeightCategory      string
	FlexibilityCategory string
	BalanceCategory     string
	Price               float64
	StockQuantity       int
}

// UpdateListingRequest is the sell page's edit payload — every field Post an Ad
// lets a seller change, plus status.
//
// Not UpdateProductRequest: that is the API-key surface's narrow patch, and
// while both routes shared it the edit form sent eight fields it did not
// recognise, so DisallowUnknownFields rejected every edit from the UI.
//
// Plain values, not pointers, because the form always submits whole. Only
// StockQuantity and OriginalPrice stay pointers, where absent differs from
// cleared.
type UpdateListingRequest struct {
	Title               string   `json:"title"`
	Price               float64  `json:"price"`
	Description         string   `json:"description"`
	Category            string   `json:"category"`
	Condition           string   `json:"condition"`
	DealingMethod       string   `json:"dealingMethod"`
	OriginalPrice       *float64 `json:"originalPrice"`
	Location            string   `json:"location"`
	State               string   `json:"state"`
	WeightCategory      string   `json:"weightCategory"`
	FlexibilityCategory string   `json:"flexibilityCategory"`
	BalanceCategory     string   `json:"balanceCategory"`
	StockQuantity       *int     `json:"stockQuantity"`
	// Honoured, but only for active/archived — see the status block in
	// updateProduct. The form echoes the current value back on an ordinary edit.
	Status string `json:"status"`
}

// asListing reshapes the payload into the type the create-side validation
// helpers take, so an edit is held to the same rules as a create rather than to
// a second, drifting copy of them.
func (r UpdateListingRequest) asListing() CreateProductRequest {
	return CreateProductRequest{
		Title:               r.Title,
		Description:         r.Description,
		Price:               r.Price,
		OriginalPrice:       r.OriginalPrice,
		Location:            r.Location,
		State:               r.State,
		Category:            r.Category,
		Condition:           r.Condition,
		DealingMethod:       r.DealingMethod,
		WeightCategory:      r.WeightCategory,
		FlexibilityCategory: r.FlexibilityCategory,
		BalanceCategory:     r.BalanceCategory,
		StockQuantity:       r.StockQuantity,
	}
}
