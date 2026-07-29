package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"transcendence/modules/user/notifications"
)

const (
	defaultReviewPageSize = 10
	maxReviewPageSize     = 50
	maxReviewCommentRunes = 1000
)

type reviewAuthor struct {
	ID        int     `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
}

type ListingReview struct {
	ID        int          `json:"id"`
	ListingID int          `json:"listingId"`
	Reviewer  reviewAuthor `json:"reviewer"`
	Rating    int          `json:"rating"`
	Comment   string       `json:"comment"`
	CreatedAt time.Time    `json:"createdAt"`
}

type listingReviewsResponse struct {
	Reviews       []ListingReview `json:"reviews"`
	Total         int             `json:"total"`
	AverageRating float64         `json:"averageRating"`
	NextOffset    *int            `json:"nextOffset"`
}

type listingReviewRequest struct {
	Rating  int    `json:"rating"`
	Comment string `json:"comment"`
}

type listingReviewEligibility struct {
	CanReview bool   `json:"canReview"`
	Reason    string `json:"reason,omitempty"`
}

func parseReviewListingID(c echo.Context) (int, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid product id")
	}
	return id, nil
}

func listingExists(db *sql.DB, listingID int) (bool, error) {
	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM listings WHERE id = $1)`, listingID).Scan(&exists)
	return exists, err
}

func getListingReviews(c echo.Context, gormDB *gorm.DB) error {
	listingID, err := parseReviewListingID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid product id"})
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}
	exists, err := listingExists(sqlDB, listingID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch reviews"})
	}
	if !exists {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "product not found"})
	}

	limit := defaultReviewPageSize
	if raw := c.QueryParam("limit"); raw != "" {
		value, parseErr := strconv.Atoi(raw)
		if parseErr != nil || value < 1 || value > maxReviewPageSize {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 50"})
		}
		limit = value
	}
	offset := 0
	if raw := c.QueryParam("offset"); raw != "" {
		value, parseErr := strconv.Atoi(raw)
		if parseErr != nil || value < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "offset must be non-negative"})
		}
		offset = value
	}

	response := listingReviewsResponse{Reviews: make([]ListingReview, 0)}
	if err := sqlDB.QueryRow(`
		SELECT COUNT(*), COALESCE(AVG(rating), 0)
		FROM listing_reviews
		WHERE listing_id = $1`, listingID,
	).Scan(&response.Total, &response.AverageRating); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch reviews"})
	}

	rows, err := sqlDB.Query(`
		SELECT r.id, r.listing_id, r.rating, r.comment, r.created_at,
			u.id, u.username, u.avatar_url
		FROM listing_reviews r
		JOIN users u ON u.id = r.reviewer_id
		WHERE r.listing_id = $1
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT $2 OFFSET $3`, listingID, limit, offset,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch reviews"})
	}
	defer rows.Close()
	for rows.Next() {
		var review ListingReview
		var avatarURL sql.NullString
		if err := rows.Scan(
			&review.ID, &review.ListingID, &review.Rating, &review.Comment, &review.CreatedAt,
			&review.Reviewer.ID, &review.Reviewer.Username, &avatarURL,
		); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch reviews"})
		}
		if avatarURL.Valid {
			value := avatarURL.String
			review.Reviewer.AvatarURL = &value
		}
		response.Reviews = append(response.Reviews, review)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch reviews"})
	}
	if next := offset + len(response.Reviews); next < response.Total {
		response.NextOffset = &next
	}
	return c.JSON(http.StatusOK, response)
}

func reviewEligibility(db *sql.DB, listingID, userID int) (listingReviewEligibility, error) {
	var sellerID int
	err := db.QueryRow(`SELECT seller_id FROM listings WHERE id = $1`, listingID).Scan(&sellerID)
	if err == sql.ErrNoRows {
		return listingReviewEligibility{Reason: "product_not_found"}, nil
	}
	if err != nil {
		return listingReviewEligibility{}, err
	}
	if sellerID == userID {
		return listingReviewEligibility{Reason: "own_listing"}, nil
	}

	var alreadyReviewed bool
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM listing_reviews WHERE listing_id = $1 AND reviewer_id = $2)`, listingID, userID).Scan(&alreadyReviewed); err != nil {
		return listingReviewEligibility{}, err
	}
	if alreadyReviewed {
		return listingReviewEligibility{Reason: "already_reviewed"}, nil
	}

	var completedOrder bool
	if err := db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM orders
			WHERE listing_id = $1 AND buyer_id = $2 AND status = 'completed'
		)`, listingID, userID,
	).Scan(&completedOrder); err != nil {
		return listingReviewEligibility{}, err
	}
	if !completedOrder {
		return listingReviewEligibility{Reason: "completed_order_required"}, nil
	}
	return listingReviewEligibility{CanReview: true}, nil
}

func getListingReviewEligibility(c echo.Context, gormDB *gorm.DB) error {
	listingID, err := parseReviewListingID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid product id"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok || userID <= 0 {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}
	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}
	eligibility, err := reviewEligibility(sqlDB, listingID, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to check review eligibility"})
	}
	if eligibility.Reason == "product_not_found" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "product not found"})
	}
	return c.JSON(http.StatusOK, eligibility)
}

func createListingReview(c echo.Context, gormDB *gorm.DB, notificationService *notifications.Service) error {
	listingID, err := parseReviewListingID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid product id"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok || userID <= 0 {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}
	var request listingReviewRequest
	if err := c.Bind(&request); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
	}
	request.Comment = strings.TrimSpace(request.Comment)
	if request.Rating < 1 || request.Rating > 5 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "rating must be between 1 and 5"})
	}
	if request.Comment == "" || utf8.RuneCountInString(request.Comment) > maxReviewCommentRunes {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "comment must contain between 1 and 1000 characters"})
	}

	sqlDB, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}
	tx, err := sqlDB.Begin()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start review"})
	}
	defer tx.Rollback()

	var sellerID int
	var listingTitle string
	err = tx.QueryRow(`SELECT seller_id, title FROM listings WHERE id = $1 FOR UPDATE`, listingID).Scan(&sellerID, &listingTitle)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "product not found"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review"})
	}
	if sellerID == userID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "you cannot review your own listing"})
	}

	var orderID int
	err = tx.QueryRow(`
		SELECT id FROM orders
		WHERE listing_id = $1 AND buyer_id = $2 AND status = 'completed'
		ORDER BY updated_at DESC, id DESC
		LIMIT 1`, listingID, userID,
	).Scan(&orderID)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "a completed order is required before reviewing"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review"})
	}

	var alreadyReviewed bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM listing_reviews WHERE listing_id = $1 AND reviewer_id = $2)`, listingID, userID).Scan(&alreadyReviewed); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review"})
	}
	if alreadyReviewed {
		return c.JSON(http.StatusConflict, map[string]string{"error": "you have already reviewed this listing"})
	}

	var review ListingReview
	review.ListingID = listingID
	review.Rating = request.Rating
	review.Comment = request.Comment
	if err := tx.QueryRow(`
		INSERT INTO listing_reviews (listing_id, reviewer_id, order_id, rating, comment)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`, listingID, userID, orderID, request.Rating, request.Comment,
	).Scan(&review.ID, &review.CreatedAt); err != nil {
		if strings.Contains(err.Error(), "listing_reviews_listing_reviewer_unique") {
			return c.JSON(http.StatusConflict, map[string]string{"error": "you have already reviewed this listing"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review"})
	}
	var avatarURL sql.NullString
	if err := tx.QueryRow(`SELECT id, username, avatar_url FROM users WHERE id = $1`, userID).Scan(&review.Reviewer.ID, &review.Reviewer.Username, &avatarURL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review"})
	}
	if avatarURL.Valid {
		value := avatarURL.String
		review.Reviewer.AvatarURL = &value
	}

	var notificationID int64
	if notificationService != nil && notificationService.Repo != nil {
		actorID := userID
		resourceID := review.ID
		notificationID, err = notificationService.Repo.CreateTx(
			tx, sellerID, &actorID, notifications.TypeReviewAdded, &resourceID,
			map[string]interface{}{
				"listingId":    listingID,
				"listingTitle": listingTitle,
				"rating":       request.Rating,
			},
		)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review notification"})
		}
	}
	if err := tx.Commit(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create review"})
	}
	if notificationID > 0 {
		notificationService.PublishByID(sellerID, notificationID)
	}
	return c.JSON(http.StatusCreated, review)
}
