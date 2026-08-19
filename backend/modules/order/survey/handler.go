package survey

import (
	"database/sql"
	"net/http"
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
	protected.GET("/orders/:id/recommendation-survey", h.getRecommendationSurvey) //
	protected.POST("/orders/:id/recommendation-survey", h.createRecommendationSurvey)
}

var recommendationSurveyValues = map[string]map[string]bool{
	"age_group": {
		"under_13": true, "13-17": true, "18-25": true,
		"26-35": true, "36-45": true, "46_plus": true,
	},
	"gender": {
		"male": true, "female": true, "prefer_not_to_say": true,
	},
	"experience_level": {
		"less_than_6_months": true, "6_months_1_year": true,
		"1-3_years": true, "3-5_years": true, "more_than_5_years": true,
	},
	"play_style": {
		"attacking": true, "defensive": true, "balanced": true, "not_sure": true,
	},
	"budget_range": {
		"under_200": true, "200-400": true, "400-700": true, "700_plus": true,
	},
}

type recommendationSurveyRequest struct {
	AgeGroup        string `json:"age_group"`
	Gender          string `json:"gender"`
	ExperienceLevel string `json:"experience_level"`
	PlayStyle       string `json:"play_style"`
	BudgetRange     string `json:"budget_range"`
}

type RecommendationTrainingFeedback struct {
	ID                  int64     `json:"id"`
	OrderID             int       `json:"orderId"`
	BuyerID             int       `json:"buyerId,omitempty"`
	AgeGroup            string    `json:"age_group"`
	Gender              string    `json:"gender"`
	ExperienceLevel     string    `json:"experience_level"`
	PlayStyle           string    `json:"play_style"`
	BudgetRange         string    `json:"budget_range"`
	WeightCategory      string    `json:"weightCategory"`
	FlexibilityCategory string    `json:"flexibilityCategory"`
	BalanceCategory     string    `json:"balanceCategory"`
	Source              string    `json:"source"`
	CreatedAt           time.Time `json:"createdAt"`
}

func validRecommendationSurvey(req recommendationSurveyRequest) bool {
	return recommendationSurveyValues["age_group"][req.AgeGroup] &&
		recommendationSurveyValues["gender"][req.Gender] &&
		recommendationSurveyValues["experience_level"][req.ExperienceLevel] &&
		recommendationSurveyValues["play_style"][req.PlayStyle] &&
		recommendationSurveyValues["budget_range"][req.BudgetRange]
}

func surveyDB(gormDB *gorm.DB) (*sql.DB, error) {
	return gormDB.DB()
}

func (h *Handler) getRecommendationSurvey(c echo.Context) error {
	db, err := surveyDB(h.gormDB)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database connection error"})
	}
	buyerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}
	orderID, err := strconv.Atoi(c.Param("id"))
	if err != nil || orderID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid order ID"})
	}

	var status string
	if err := db.QueryRow(
		`SELECT status FROM orders WHERE id = $1 AND buyer_id = $2`,
		orderID,
		buyerID,
	).Scan(&status); err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Order not found"})
	} else if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to inspect survey eligibility"})
	}

	feedback, err := findRecommendationFeedback(db, orderID, buyerID)
	if err != nil && err != sql.ErrNoRows {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load survey"})
	}
	submitted := err == nil
	response := map[string]interface{}{
		"eligible":  (status == "pending" || status == "completed") && !submitted,
		"submitted": submitted,
		"status":    status,
	}
	if submitted {
		response["feedback"] = feedback
	}
	return c.JSON(http.StatusOK, response)
}

func (h *Handler) createRecommendationSurvey(c echo.Context) error {
	db, err := surveyDB(h.gormDB)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database connection error"})
	}
	buyerID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}
	orderID, err := strconv.Atoi(c.Param("id"))
	if err != nil || orderID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid order ID"})
	}
	var req recommendationSurveyRequest
	if err := c.Bind(&req); err != nil || !validRecommendationSurvey(req) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Survey contains invalid option values"})
	}

	var feedback RecommendationTrainingFeedback
	err = db.QueryRow(`
		INSERT INTO recommendation_training_feedback (
			order_id, buyer_id, age_group, gender, experience_level,
			play_style, budget_range, weight_category,
			flexibility_category, balance_category
		)
		SELECT
			o.id, o.buyer_id, $3, $4, $5, $6, $7,
			l.weight_category, l.flexibility_category, l.balance_category
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		WHERE o.id = $1
		  AND o.buyer_id = $2
		  AND o.status IN ('pending', 'completed')
		  AND l.weight_category IN ('1U', '2U', '3U', '4U', '5U', '6U', '7U', '8U')
		  AND l.flexibility_category IN ('Stiff Shaft', 'Medium Flex', 'High Flexibility')
		  AND l.balance_category IN ('Head Heavy', 'Even Balance', 'Head Light')
		ON CONFLICT (order_id) DO NOTHING
		RETURNING
			id, order_id, buyer_id, age_group, gender, experience_level,
			play_style, budget_range, weight_category,
			flexibility_category, balance_category, created_at`,
		orderID,
		buyerID,
		req.AgeGroup,
		req.Gender,
		req.ExperienceLevel,
		req.PlayStyle,
		req.BudgetRange,
	).Scan(
		&feedback.ID,
		&feedback.OrderID,
		&feedback.BuyerID,
		&feedback.AgeGroup,
		&feedback.Gender,
		&feedback.ExperienceLevel,
		&feedback.PlayStyle,
		&feedback.BudgetRange,
		&feedback.WeightCategory,
		&feedback.FlexibilityCategory,
		&feedback.BalanceCategory,
		&feedback.CreatedAt,
	)
	if err == sql.ErrNoRows {
		var exists bool
		if queryErr := db.QueryRow(
			`SELECT EXISTS (
				SELECT 1 FROM recommendation_training_feedback
				WHERE order_id = $1 AND buyer_id = $2
			)`,
			orderID,
			buyerID,
		).Scan(&exists); queryErr == nil && exists {
			return c.JSON(http.StatusConflict, map[string]string{"error": "Survey already submitted for this order"})
		}
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "Order is not eligible or its listing has incomplete racket specifications",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save recommendation survey"})
	}
	feedback.Source = "transaction_survey"
	return c.JSON(http.StatusCreated, feedback)
}

func findRecommendationFeedback(
	db *sql.DB,
	orderID int,
	buyerID int,
) (RecommendationTrainingFeedback, error) {
	var feedback RecommendationTrainingFeedback
	err := db.QueryRow(`
		SELECT
			id, order_id, buyer_id, age_group, gender, experience_level,
			play_style, budget_range, weight_category,
			flexibility_category, balance_category, created_at
		FROM recommendation_training_feedback
		WHERE order_id = $1 AND buyer_id = $2`,
		orderID,
		buyerID,
	).Scan(
		&feedback.ID,
		&feedback.OrderID,
		&feedback.BuyerID,
		&feedback.AgeGroup,
		&feedback.Gender,
		&feedback.ExperienceLevel,
		&feedback.PlayStyle,
		&feedback.BudgetRange,
		&feedback.WeightCategory,
		&feedback.FlexibilityCategory,
		&feedback.BalanceCategory,
		&feedback.CreatedAt,
	)
	feedback.Source = "transaction_survey"
	return feedback, err
}
