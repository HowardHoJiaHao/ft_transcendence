package main

import (
	"database/sql"
	"log"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Listings on this marketplace are single secondhand items sold at most once,
// so per-item stats are framed as sold-or-not + time-to-sell rather than
// units/revenue-per-unit.
type SellerItemStat struct {
	ListingID       int     `json:"listingId"`
	Title           string  `json:"title"`
	Price           float64 `json:"price"`
	Category        string  `json:"category"`
	Status          string  `json:"status"`
	DaysListed      int     `json:"daysListed"`
	ViewsLast30Days int     `json:"viewsLast30Days"`
	Sold            bool    `json:"sold"`
	SoldAt          *string `json:"soldAt,omitempty"`
	Revenue         float64 `json:"revenue"`
	Stale           bool    `json:"stale"`
}

type SellerMonthlyStat struct {
	Month      string  `json:"month"` // "YYYY-MM"
	OrderCount int     `json:"orderCount"`
	Revenue    float64 `json:"revenue"`
}

type CategoryStat struct {
	Category  string  `json:"category"`
	ItemsSold int     `json:"itemsSold"`
	Revenue   float64 `json:"revenue"`
}

type MonthlyCategoryStat struct {
	Month      string  `json:"month"` // "YYYY-MM"
	Category   string  `json:"category"`
	OrderCount int     `json:"orderCount"`
	Revenue    float64 `json:"revenue"`
}

type SellerSummary struct {
	TotalRevenue      float64             `json:"totalRevenue"`
	PendingOrders     int                 `json:"pendingOrders"`
	ItemsSold         int                 `json:"itemsSold"`
	ItemsActive       int                 `json:"itemsActive"`
	ItemsArchived     int                 `json:"itemsArchived"`
	SellThroughRate   float64               `json:"sellThroughRate"` // percent, 0-100
	AvgDaysToSell     float64               `json:"avgDaysToSell"`
	MonthlyRevenue    []SellerMonthlyStat   `json:"monthlyRevenue"`
	MonthlyByCategory []MonthlyCategoryStat `json:"monthlyByCategory"`
	CategoryBreakdown []CategoryStat        `json:"categoryBreakdown"`
}

const staleAfterDays = 30

// getSellerDashboardItems returns per-listing stats for the authenticated seller.
func getSellerDashboardItems(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

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
			COALESCE((SELECT COUNT(*) FROM orders o
				WHERE o.listing_id = l.id AND o.status = 'pending'), 0) AS pending_orders,
			COALESCE((SELECT SUM(o.total_price) FROM orders o
				WHERE o.listing_id = l.id AND o.status = 'completed'), 0) AS revenue,
			COALESCE((SELECT COUNT(*) FROM analytics_events ae
				WHERE ae.listing_id = l.id
				  AND ae.event_type = 'listing_viewed'
				  AND ae.created_at >= NOW() - INTERVAL '30 days'), 0) AS views_last_30_days
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
			&createdAt, &updatedAt, &soldAt, &pendingOrders, &it.Revenue, &it.ViewsLast30Days,
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

		it.Stale = it.Status == "active" && !it.Sold && it.DaysListed >= staleAfterDays

		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller dashboard items"})
	}

	return c.JSON(200, map[string]interface{}{"items": items})
}

// getSellerDashboardSummary returns account-level stats, a monthly revenue series,
// and a category breakdown for the authenticated seller.
func getSellerDashboardSummary(c echo.Context, gormDB *gorm.DB) error {
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Database connection error"})
	}

	sellerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(401, map[string]string{"error": "Unauthorized"})
	}

	months := 12
	if m := c.QueryParam("months"); m != "" {
		if parsed, err := strconv.Atoi(m); err == nil && parsed > 0 && parsed <= 36 {
			months = parsed
		}
	}

	var summary SellerSummary

	// Listing funnel: sold vs active vs archived, by listing status.
	err = sqlDB.QueryRow(`
		SELECT
			COALESCE(COUNT(*) FILTER (WHERE status = 'sold'), 0),
			COALESCE(COUNT(*) FILTER (WHERE status = 'active'), 0),
			COALESCE(COUNT(*) FILTER (WHERE status = 'archived'), 0)
		FROM listings WHERE seller_id = $1`, sellerID,
	).Scan(&summary.ItemsSold, &summary.ItemsActive, &summary.ItemsArchived)
	if err != nil {
		log.Printf("Error querying seller listing funnel: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}

	if summary.ItemsSold+summary.ItemsActive > 0 {
		summary.SellThroughRate = float64(summary.ItemsSold) / float64(summary.ItemsSold+summary.ItemsActive) * 100
	}

	err = sqlDB.QueryRow(`
		SELECT
			COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0),
			COALESCE(COUNT(*) FILTER (WHERE status = 'pending'), 0)
		FROM orders WHERE seller_id = $1`, sellerID,
	).Scan(&summary.TotalRevenue, &summary.PendingOrders)
	if err != nil {
		log.Printf("Error querying seller revenue: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}

	// Average days from listing creation to the completed order.
	err = sqlDB.QueryRow(`
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (o.created_at - l.created_at)) / 86400.0), 0)
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.seller_id = $1 AND o.status = 'completed'`, sellerID,
	).Scan(&summary.AvgDaysToSell)
	if err != nil {
		log.Printf("Error querying seller avg time to sell: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}

	rows, err := sqlDB.Query(`
		SELECT
			TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
			COUNT(*) AS order_count,
			SUM(total_price) AS revenue
		FROM orders
		WHERE seller_id = $1
		  AND status = 'completed'
		  AND created_at >= DATE_TRUNC('month', NOW()) - make_interval(months => $2)
		GROUP BY month
		ORDER BY month`, sellerID, months-1,
	)
	if err != nil {
		log.Printf("Error querying seller monthly revenue: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}
	defer rows.Close()

	monthly := []SellerMonthlyStat{}
	for rows.Next() {
		var m SellerMonthlyStat
		if err := rows.Scan(&m.Month, &m.OrderCount, &m.Revenue); err != nil {
			log.Printf("Error scanning monthly revenue row: %v", err)
			continue
		}
		monthly = append(monthly, m)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller monthly revenue"})
	}
	summary.MonthlyRevenue = monthly

	mcRows, err := sqlDB.Query(`
		SELECT
			TO_CHAR(DATE_TRUNC('month', o.created_at), 'YYYY-MM') AS month,
			COALESCE(l.category, 'Others') AS category,
			COUNT(o.id) AS order_count,
			SUM(o.total_price) AS revenue
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.seller_id = $1
		  AND o.status = 'completed'
		  AND o.created_at >= DATE_TRUNC('month', NOW()) - make_interval(months => $2)
		GROUP BY 1, 2
		ORDER BY 1, 2`, sellerID, months-1,
	)
	if err != nil {
		log.Printf("Error querying seller monthly category revenue: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}
	defer mcRows.Close()

	monthlyByCat := []MonthlyCategoryStat{}
	for mcRows.Next() {
		var mc MonthlyCategoryStat
		if err := mcRows.Scan(&mc.Month, &mc.Category, &mc.OrderCount, &mc.Revenue); err != nil {
			log.Printf("Error scanning monthly category row: %v", err)
			continue
		}
		monthlyByCat = append(monthlyByCat, mc)
	}
	if err := mcRows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller monthly categories"})
	}
	summary.MonthlyByCategory = monthlyByCat

	catRows, err := sqlDB.Query(`
		SELECT
			COALESCE(l.category, 'Others'),
			COUNT(o.id) AS items_sold,
			COALESCE(SUM(o.total_price), 0) AS revenue
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.seller_id = $1 AND o.status = 'completed'
		GROUP BY 1
		ORDER BY revenue DESC`, sellerID,
	)
	if err != nil {
		log.Printf("Error querying seller category breakdown: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to fetch seller summary"})
	}
	defer catRows.Close()

	categories := []CategoryStat{}
	for catRows.Next() {
		var cs CategoryStat
		if err := catRows.Scan(&cs.Category, &cs.ItemsSold, &cs.Revenue); err != nil {
			log.Printf("Error scanning category row: %v", err)
			continue
		}
		categories = append(categories, cs)
	}
	if err := catRows.Err(); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed scanning seller categories"})
	}
	summary.CategoryBreakdown = categories

	return c.JSON(200, summary)
}
