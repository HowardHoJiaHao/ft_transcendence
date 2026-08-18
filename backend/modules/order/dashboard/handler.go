package dashboard

import (
	"database/sql"
	"errors"
	"log"
	"sort"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/myMiddleware"
)

type Handler struct {
	gormDB *gorm.DB
	rawDB  *sql.DB
}

func NewHandler(gormDB *gorm.DB, rawDB *sql.DB) *Handler {
	return &Handler{gormDB: gormDB, rawDB: rawDB}
}

func (h *Handler) RegisterRoutes(v1 *echo.Group) {
	protected := v1.Group("")
	protected.Use(myMiddleware.JWTAuth(h.rawDB))
	protected.GET("/seller/dashboard/items", h.getSellerDashboardItems)
	protected.GET("/seller/dashboard/summary", h.getSellerDashboardSummary)
	protected.GET("/seller/dashboard/categories", h.getSellerDashboardCategories)
}

type SellerItemStat struct {
	ListingID  int     `json:"listingId"`
	Title      string  `json:"title"`
	Price      float64 `json:"price"`
	Category   string  `json:"category"`
	Status     string  `json:"status"`
	Quantity   int     `json:"quantity"`
	DaysListed int     `json:"daysListed"`
	Sold       bool    `json:"sold"`
	SoldAt     *string `json:"soldAt,omitempty"`
	Revenue    float64 `json:"revenue"`
}

// One sold listing inside a category group.
type CategorySoldItem struct {
	ListingID  int     `json:"listingId"`
	Title      string  `json:"title"`
	SoldAt     string  `json:"soldAt"`
	DaysToSell float64 `json:"daysToSell"`
	Revenue    float64 `json:"revenue"`
}

// A Sales-by-Category group: the summary row plus the sold listings behind it.
type CategoryStat struct {
	Category      string             `json:"category"`
	ItemsSold     int                `json:"itemsSold"`
	Revenue       float64            `json:"revenue"`
	AvgDaysToSell float64            `json:"avgDaysToSell"`
	Items         []CategorySoldItem `json:"items"`
}

type MonthlyCategoryStat struct {
	Month      string  `json:"month"` // "YYYY-MM"
	Category   string  `json:"category"`
	OrderCount int     `json:"orderCount"`
	Revenue    float64 `json:"revenue"`
}

type SellerSummary struct {
	TotalRevenue      float64               `json:"totalRevenue"`
	PendingOrders     int                   `json:"pendingOrders"`
	ItemsSold         int                   `json:"itemsSold"`
	ItemsActive       int                   `json:"itemsActive"`
	ItemsArchived     int                   `json:"itemsArchived"`
	AvgDaysToSell     float64               `json:"avgDaysToSell"`
	MonthlyByCategory []MonthlyCategoryStat `json:"monthlyByCategory"`
	// Echo of the resolved window so the client can label the chart with the
	// range actually reported on, which may differ from what it asked for.
	RangeFrom string `json:"rangeFrom"`
	RangeTo   string `json:"rangeTo"`
}

// build a default range
// if the client sends from/to values, use them instead
// validate that the start is not after the end
func resolveReportRange(monthsParam, fromParam, toParam string, now time.Time) (time.Time, time.Time, error) {
	months := 12
	if monthsParam != "" {
		// 36 month mean max 3 years
		if parsed, err := strconv.Atoi(monthsParam); err == nil && parsed > 0 && parsed <= 36 {
			months = parsed
		}
	}

	// Default window: the first day of the month `months-1` back, through now.
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -(months - 1), 0)
	to := now

	if fromParam != "" {
		parsed, err := time.ParseInLocation("2006-01-02", fromParam, now.Location())
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("Invalid 'from' date; expected YYYY-MM-DD")
		}
		from = parsed
	}
	if toParam != "" {
		parsed, err := time.ParseInLocation("2006-01-02", toParam, now.Location())
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("Invalid 'to' date; expected YYYY-MM-DD")
		}
		// Inclusive end date: cover the whole of the chosen day.
		to = parsed.AddDate(0, 0, 1).Add(-time.Nanosecond)
	}
	if from.After(to) {
		return time.Time{}, time.Time{}, errors.New("'from' must not be after 'to'")
	}
	return from, to, nil
}

type categorySoldRow struct {
	CategorySoldItem
	Category string
}

// groupByCategory turns a flat list of sold listings into category groups,
// deriving each group's totals from the very rows it carries.
func groupByCategory(sold []categorySoldRow) []CategoryStat {
	groups := map[string]*CategoryStat{}
	for _, row := range sold {
		group, ok := groups[row.Category]
		if !ok {
			group = &CategoryStat{Category: row.Category, Items: []CategorySoldItem{}}
			groups[row.Category] = group
		}
		group.Items = append(group.Items, row.CategorySoldItem)
		group.Revenue += row.Revenue
	}

	categories := make([]CategoryStat, 0, len(groups))
	for _, group := range groups {
		var totalDays float64
		for _, item := range group.Items {
			totalDays += item.DaysToSell
		}
		// A group only exists because a row created it, so Items is never empty.
		group.ItemsSold = len(group.Items)
		group.AvgDaysToSell = totalDays / float64(group.ItemsSold)
		categories = append(categories, *group)
	}
	sort.Slice(categories, func(i, j int) bool {
		if categories[i].Revenue != categories[j].Revenue {
			return categories[i].Revenue > categories[j].Revenue
		}
		return categories[i].Category < categories[j].Category
	})
	return categories
}

// getSellerDashboardItems returns per-listing stats for the authenticated
// seller: every listing they own, newest first, unfiltered and unpaged.
//
// It takes no query parameters. Filtering, sorting and pagination all happen
// client-side on the My Items table, and there is deliberately no date range —
// this is an inventory list, not a report.
func (h *Handler) getSellerDashboardItems(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	// sold_at min is to that incase duplicate and it return some value rather thn nothing
	// pending_orders use count actully it is just 1 or 0 as
	// listing quantity - how many are there right now
	// order quantity - how many in one transaction (history)

	query := `
		SELECT
			l.id,
			l.title,
			l.price,
			COALESCE(l.category, 'Others'),
			COALESCE(l.status, 'active'),
			l.created_at,
			l.updated_at,
			(SELECT MIN(o.created_at) FROM orders o
				WHERE o.listing_id = l.id AND o.status = 'completed') AS sold_at,
			(SELECT COUNT(*) FROM orders o
				WHERE o.listing_id = l.id AND o.status = 'pending') AS pending_orders,
			COALESCE((SELECT SUM(o.total_price) FROM orders o
				WHERE o.listing_id = l.id AND o.status = 'completed'), 0) AS revenue,
			l.stock_quantity + COALESCE((SELECT SUM(o.quantity) FROM orders o
				WHERE o.listing_id = l.id
				  AND o.status IN ('pending', 'completed')), 0) AS quantity
		FROM listings l
		WHERE l.seller_id = $1
		ORDER BY l.created_at DESC`

	rows, err := sqlDB.Query(query, sellerID)
	if err != nil {
		log.Printf("Error querying seller dashboard items: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller dashboard items"})
	}
	defer rows.Close()

	now := time.Now()
	items := []SellerItemStat{}
	for rows.Next() {
		var it SellerItemStat
		var createdAt, updatedAt time.Time
		var soldAt sql.NullTime
		var pendingOrders int
		if err := rows.Scan(
			&it.ListingID, &it.Title, &it.Price, &it.Category, &it.Status,
			&createdAt, &updatedAt, &soldAt, &pendingOrders, &it.Revenue,
			&it.Quantity,
		); err != nil {
			log.Printf("Error scanning seller dashboard item: %v", err)
			continue
		}

		it.Sold = it.Status == "sold" || soldAt.Valid

		// A listing with orders awaiting the seller's completion shows as
		// "pending" — it needs action, regardless of remaining stock.
		if pendingOrders > 0 && it.Status != "archived" {
			it.Status = "pending"
		}

		// Days on market: until the completed order if one exists; if the seller
		// marked it sold manually (no order row), fall back to updated_at.
		end := now
		if soldAt.Valid {
			end = soldAt.Time
			s := soldAt.Time.Format("2006-01-02")
			it.SoldAt = &s
		} else if it.Status == "sold" {
			end = updatedAt
		}
		it.DaysListed = int(end.Sub(createdAt).Hours() / 24)
		if it.DaysListed < 0 {
			it.DaysListed = 0
		}

		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller dashboard items"})
	}

	return c.JSON(200, map[string]interface{}{"items": items})
}

// getSellerDashboardSummary returns the KPI tiles and the sales-trends chart
// series for the authenticated seller.
//
// GET /api/v1/seller/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// GET /api/v1/seller/dashboard/summary?months=N          (trailing window)
//
// Two queries:
//
//  1. one row of six scalars  → the KPI tiles
//  2. month × category rows   → the stacked chart
func (h *Handler) getSellerDashboardSummary(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	rangeFrom, rangeTo, err := resolveReportRange(
		c.QueryParam("months"), c.QueryParam("from"), c.QueryParam("to"), time.Now(),
	)
	if err != nil {
		return c.JSON(400, map[string]string{"error": err.Error()})
	}

	var summary SellerSummary
	summary.RangeFrom = rangeFrom.Format("2006-01-02")
	summary.RangeTo = rangeTo.Format("2006-01-02")

	// Every KPI tile in one round trip. These six are all single-value aggregates
	// EPOCH is in seconds and 86400 is seconds in a day
	err = sqlDB.QueryRow(`
		SELECT
			(SELECT COUNT(*) FILTER (WHERE status = 'sold')
				FROM listings WHERE seller_id = $1),
			(SELECT COUNT(*) FILTER (WHERE status = 'active')
				FROM listings WHERE seller_id = $1),
			(SELECT COUNT(*) FILTER (WHERE status = 'archived')
				FROM listings WHERE seller_id = $1),
			(SELECT COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0)
				FROM orders WHERE seller_id = $1),
			(SELECT COALESCE(COUNT(*) FILTER (WHERE status = 'pending'), 0)
				FROM orders WHERE seller_id = $1),
			(SELECT COALESCE(
					AVG(EXTRACT(EPOCH FROM (o.created_at - l.created_at)) / 86400.0), 0)
				FROM orders o
				JOIN listings l ON l.id = o.listing_id
				WHERE o.seller_id = $1 AND o.status = 'completed')`, sellerID,
	).Scan(
		&summary.ItemsSold, &summary.ItemsActive, &summary.ItemsArchived,
		&summary.TotalRevenue, &summary.PendingOrders, &summary.AvgDaysToSell,
	)
	if err != nil {
		log.Printf("Error querying seller summary totals: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}

	rows, err := sqlDB.Query(`
		SELECT
			TO_CHAR(DATE_TRUNC('month', o.created_at), 'YYYY-MM') AS month,
			COALESCE(l.category, 'Others') AS category,
			COUNT(o.id) AS order_count,
			SUM(o.total_price) AS revenue
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.seller_id = $1
		  AND o.status = 'completed'
		  AND o.created_at >= $2
		  AND o.created_at <= $3
		GROUP BY 1, 2
		ORDER BY 1, 2`, sellerID, rangeFrom, rangeTo,
	)
	if err != nil {
		log.Printf("Error querying seller monthly category revenue: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}
	defer rows.Close()

	monthlyByCat := []MonthlyCategoryStat{}
	for rows.Next() {
		var stat MonthlyCategoryStat
		if err := rows.Scan(&stat.Month, &stat.Category, &stat.OrderCount, &stat.Revenue); err != nil {
			log.Printf("Error scanning monthly category row: %v", err)
			continue
		}
		monthlyByCat = append(monthlyByCat, stat)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller monthly categories"})
	}
	summary.MonthlyByCategory = monthlyByCat

	return c.JSON(200, summary)
}

// getSellerDashboardCategories returns the Sales-by-Category view in full: one
// group per category, each carrying the sold listings behind its totals.
//
// GET /api/v1/seller/dashboard/categories?from=YYYY-MM-DD&to=YYYY-MM-DD
// GET /api/v1/seller/dashboard/categories?months=N
func (h *Handler) getSellerDashboardCategories(c echo.Context) error {
	sqlDB, err := h.gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	rangeFrom, rangeTo, err := resolveReportRange(
		c.QueryParam("months"), c.QueryParam("from"), c.QueryParam("to"), time.Now(),
	)
	if err != nil {
		return c.JSON(400, map[string]string{"error": err.Error()})
	}

	// One row per completed order in the window. Days-to-sell is measured the
	// same way as the dashboard tile -- seconds between listing and sale over
	// 86400 -- so the two figures are directly comparable.
	rows, err := sqlDB.Query(`
		SELECT
			COALESCE(l.category, 'Others') AS category,
			l.id,
			l.title,
			TO_CHAR(o.created_at, 'YYYY-MM-DD') AS sold_at,
			EXTRACT(EPOCH FROM (o.created_at - l.created_at)) / 86400.0 AS days_to_sell,
			o.total_price
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.seller_id = $1
		  AND o.status = 'completed'
		  AND o.created_at >= $2
		  AND o.created_at <= $3
		ORDER BY o.created_at`, sellerID, rangeFrom, rangeTo,
	)
	if err != nil {
		log.Printf("Error querying seller category sales: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch category sales"})
	}
	defer rows.Close()

	sold := []categorySoldRow{}
	for rows.Next() {
		var row categorySoldRow
		if err := rows.Scan(
			&row.Category, &row.ListingID, &row.Title,
			&row.SoldAt, &row.DaysToSell, &row.Revenue,
		); err != nil {
			log.Printf("Error scanning category sale row: %v", err)
			continue
		}
		sold = append(sold, row)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning category sales"})
	}

	return c.JSON(200, map[string]interface{}{"categories": groupByCategory(sold)})
}
