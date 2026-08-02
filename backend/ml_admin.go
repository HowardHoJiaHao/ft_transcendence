package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

const baselineTrainingRows = 1000

type mlTrainingRun struct {
	ID              int64                  `json:"id"`
	RequestedBy     *int                   `json:"requestedBy,omitempty"`
	RequestedByRole string                 `json:"requestedByRole"`
	Status          string                 `json:"status"`
	Progress        int                    `json:"progress"`
	Stage           string                 `json:"stage"`
	SyntheticRows   int                    `json:"syntheticRows"`
	SurveyRows      int                    `json:"surveyRows"`
	TotalRows       int                    `json:"totalRows"`
	ModelVersion    *string                `json:"modelVersion,omitempty"`
	Metrics         map[string]interface{} `json:"metrics"`
	DatasetSHA256   *string                `json:"datasetSha256,omitempty"`
	ArtifactSHA256  *string                `json:"artifactSha256,omitempty"`
	ErrorMessage    *string                `json:"errorMessage,omitempty"`
	IsActive        bool                   `json:"isActive"`
	CreatedAt       time.Time              `json:"createdAt"`
	StartedAt       *time.Time             `json:"startedAt,omitempty"`
	FinishedAt      *time.Time             `json:"finishedAt,omitempty"`
}

func getMLStatus(c echo.Context, db *sql.DB) error {
	var surveyRows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM recommendation_training_feedback`).Scan(&surveyRows); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load ML status"})
	}

	activeModel := map[string]interface{}{
		"version":        "1.0.0",
		"trainedAt":      nil,
		"artifactSha256": nil,
	}
	if run, err := querySingleMLRun(db, `
		SELECT
			id, requested_by, requested_by_role, status, progress, stage,
			synthetic_rows, survey_rows, total_rows, model_version, metrics,
			dataset_sha256, artifact_sha256, error_message, is_active,
			created_at, started_at, finished_at
		FROM ml_training_runs
		WHERE is_active
		ORDER BY id DESC
		LIMIT 1`); err == nil {
		activeModel["version"] = run.ModelVersion
		activeModel["trainedAt"] = run.FinishedAt
		activeModel["artifactSha256"] = run.ArtifactSHA256
	}

	var activeRun interface{}
	if run, err := querySingleMLRun(db, `
		SELECT
			id, requested_by, requested_by_role, status, progress, stage,
			synthetic_rows, survey_rows, total_rows, model_version, metrics,
			dataset_sha256, artifact_sha256, error_message, is_active,
			created_at, started_at, finished_at
		FROM ml_training_runs
		WHERE status IN ('queued', 'running')
		ORDER BY id DESC
		LIMIT 1`); err == nil {
		activeRun = run
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"syntheticRows": baselineTrainingRows,
		"surveyRows":    surveyRows,
		"totalRows":     baselineTrainingRows + surveyRows,
		"activeModel":   activeModel,
		"activeRun":     activeRun,
	})
}

func listMLFeedback(c echo.Context, db *sql.DB) error {
	rows, err := db.Query(`
		SELECT
			id, order_id, buyer_id, age_group, gender, experience_level,
			play_style, budget_range, weight_category,
			flexibility_category, balance_category, created_at
		FROM recommendation_training_feedback
		ORDER BY id DESC
		LIMIT 25`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load training feedback"})
	}
	defer rows.Close()

	feedback := []recommendationTrainingFeedback{}
	for rows.Next() {
		var item recommendationTrainingFeedback
		if err := rows.Scan(
			&item.ID,
			&item.OrderID,
			&item.BuyerID,
			&item.AgeGroup,
			&item.Gender,
			&item.ExperienceLevel,
			&item.PlayStyle,
			&item.BudgetRange,
			&item.WeightCategory,
			&item.FlexibilityCategory,
			&item.BalanceCategory,
			&item.CreatedAt,
		); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read training feedback"})
		}
		item.Source = "transaction_survey"
		feedback = append(feedback, item)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"feedback": feedback})
}

func listMLRuns(c echo.Context, db *sql.DB) error {
	rows, err := db.Query(`
		SELECT
			id, requested_by, requested_by_role, status, progress, stage,
			synthetic_rows, survey_rows, total_rows, model_version, metrics,
			dataset_sha256, artifact_sha256, error_message, is_active,
			created_at, started_at, finished_at
		FROM ml_training_runs
		ORDER BY id DESC
		LIMIT 20`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load training runs"})
	}
	defer rows.Close()
	runs := []mlTrainingRun{}
	for rows.Next() {
		run, err := scanMLRun(rows)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read training runs"})
		}
		runs = append(runs, run)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"runs": runs})
}

func getMLRun(c echo.Context, db *sql.DB) error {
	runID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || runID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid training run ID"})
	}
	run, err := querySingleMLRun(db, `
		SELECT
			id, requested_by, requested_by_role, status, progress, stage,
			synthetic_rows, survey_rows, total_rows, model_version, metrics,
			dataset_sha256, artifact_sha256, error_message, is_active,
			created_at, started_at, finished_at
		FROM ml_training_runs
		WHERE id = $1`,
		runID,
	)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Training run not found"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load training run"})
	}
	return c.JSON(http.StatusOK, run)
}

func createMLRetrainingRun(c echo.Context, db *sql.DB) error {
	role, _ := c.Get("userRole").(string)
	if role != "admin" && role != "moderator" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator or moderator access required"})
	}
	requestedBy, _ := c.Get("adminUserId").(int)
	var requester interface{}
	if requestedBy > 0 {
		requester = requestedBy
	}

	var run mlTrainingRun
	var metricsBytes []byte
	var requesterValue sql.NullInt64
	err := db.QueryRow(`
		INSERT INTO ml_training_runs (
			requested_by, requested_by_role, status, progress, stage,
			synthetic_rows, survey_rows, total_rows
		)
		VALUES (
			$1, $2, 'queued', 0, 'Queued', $3,
			(SELECT COUNT(*)::INTEGER FROM recommendation_training_feedback),
			$3 + (SELECT COUNT(*)::INTEGER FROM recommendation_training_feedback)
		)
		RETURNING
			id, requested_by, requested_by_role, status, progress, stage,
			synthetic_rows, survey_rows, total_rows, model_version, metrics,
			dataset_sha256, artifact_sha256, error_message, is_active,
			created_at, started_at, finished_at`,
		requester,
		role,
		baselineTrainingRows,
	).Scan(
		&run.ID,
		&requesterValue,
		&run.RequestedByRole,
		&run.Status,
		&run.Progress,
		&run.Stage,
		&run.SyntheticRows,
		&run.SurveyRows,
		&run.TotalRows,
		&run.ModelVersion,
		&metricsBytes,
		&run.DatasetSHA256,
		&run.ArtifactSHA256,
		&run.ErrorMessage,
		&run.IsActive,
		&run.CreatedAt,
		&run.StartedAt,
		&run.FinishedAt,
	)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			return c.JSON(http.StatusConflict, map[string]string{"error": "A retraining run is already queued or running"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to queue retraining"})
	}
	if requesterValue.Valid {
		value := int(requesterValue.Int64)
		run.RequestedBy = &value
	}
	run.Metrics = decodeMetrics(metricsBytes)
	return c.JSON(http.StatusAccepted, run)
}

type mlRunScanner interface {
	Scan(dest ...interface{}) error
}

func scanMLRun(scanner mlRunScanner) (mlTrainingRun, error) {
	var run mlTrainingRun
	var requestedBy sql.NullInt64
	var modelVersion sql.NullString
	var datasetSHA sql.NullString
	var artifactSHA sql.NullString
	var errorMessage sql.NullString
	var startedAt sql.NullTime
	var finishedAt sql.NullTime
	var metricsBytes []byte
	err := scanner.Scan(
		&run.ID,
		&requestedBy,
		&run.RequestedByRole,
		&run.Status,
		&run.Progress,
		&run.Stage,
		&run.SyntheticRows,
		&run.SurveyRows,
		&run.TotalRows,
		&modelVersion,
		&metricsBytes,
		&datasetSHA,
		&artifactSHA,
		&errorMessage,
		&run.IsActive,
		&run.CreatedAt,
		&startedAt,
		&finishedAt,
	)
	if err != nil {
		return run, err
	}
	if requestedBy.Valid {
		value := int(requestedBy.Int64)
		run.RequestedBy = &value
	}
	if modelVersion.Valid {
		run.ModelVersion = &modelVersion.String
	}
	if datasetSHA.Valid {
		run.DatasetSHA256 = &datasetSHA.String
	}
	if artifactSHA.Valid {
		run.ArtifactSHA256 = &artifactSHA.String
	}
	if errorMessage.Valid {
		run.ErrorMessage = &errorMessage.String
	}
	if startedAt.Valid {
		run.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		run.FinishedAt = &finishedAt.Time
	}
	run.Metrics = decodeMetrics(metricsBytes)
	return run, nil
}

func querySingleMLRun(db *sql.DB, query string, args ...interface{}) (mlTrainingRun, error) {
	return scanMLRun(db.QueryRow(query, args...))
}

func decodeMetrics(value []byte) map[string]interface{} {
	metrics := map[string]interface{}{}
	_ = json.Unmarshal(value, &metrics)
	return metrics
}
