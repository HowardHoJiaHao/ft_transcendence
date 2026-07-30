package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

const validSurveyBody = `{
	"age_group":"18-25",
	"gender":"prefer_not_to_say",
	"experience_level":"1-3_years",
	"play_style":"attacking",
	"budget_range":"200-400"
}`

func newSurveyContext(
	method string,
	body string,
	orderID string,
	userID interface{},
) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	request := httptest.NewRequest(method, "/orders/"+orderID+"/recommendation-survey", bytes.NewBufferString(body))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetParamNames("id")
	context.SetParamValues(orderID)
	if userID != nil {
		context.Set("userId", userID)
	}
	return context, recorder
}

func TestCreateRecommendationSurveyCopiesTrustedListingTargets(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	now := time.Now()
	mock.ExpectQuery("INSERT INTO recommendation_training_feedback").
		WithArgs(91, 42, "18-25", "prefer_not_to_say", "1-3_years", "attacking", "200-400").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "order_id", "buyer_id", "age_group", "gender",
			"experience_level", "play_style", "budget_range", "weight_category",
			"flexibility_category", "balance_category", "created_at",
		}).AddRow(
			7, 91, 42, "18-25", "prefer_not_to_say", "1-3_years",
			"attacking", "200-400", "4U", "Medium Flex", "Head Heavy", now,
		))

	context, recorder := newSurveyContext(http.MethodPost, validSurveyBody, "91", 42)
	if err := createRecommendationSurvey(context, gormDB); err != nil {
		t.Fatalf("createRecommendationSurvey() error = %v", err)
	}
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte(`"weightCategory":"4U"`)) {
		t.Fatalf("response did not contain server-side listing targets: %s", recorder.Body.String())
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateRecommendationSurveyRejectsInvalidOptionsWithoutDatabaseWrite(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	context, recorder := newSurveyContext(
		http.MethodPost,
		`{"age_group":"DROP TABLE orders"}`,
		"91",
		42,
	)
	if err := createRecommendationSurvey(context, gormDB); err != nil {
		t.Fatalf("createRecommendationSurvey() error = %v", err)
	}
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateRecommendationSurveyRejectsDuplicateOrder(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("INSERT INTO recommendation_training_feedback").
		WithArgs(91, 42, "18-25", "prefer_not_to_say", "1-3_years", "attacking", "200-400").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs(91, 42).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	context, recorder := newSurveyContext(http.MethodPost, validSurveyBody, "91", 42)
	if err := createRecommendationSurvey(context, gormDB); err != nil {
		t.Fatalf("createRecommendationSurvey() error = %v", err)
	}
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestCreateMLRetrainingRunAllowsModeratorAndReturnsAccepted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now()
	mock.ExpectQuery("INSERT INTO ml_training_runs").
		WithArgs(17, "moderator", baselineTrainingRows).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "requested_by", "requested_by_role", "status", "progress", "stage",
			"synthetic_rows", "survey_rows", "total_rows", "model_version", "metrics",
			"dataset_sha256", "artifact_sha256", "error_message", "is_active",
			"created_at", "started_at", "finished_at",
		}).AddRow(
			3, 17, "moderator", "queued", 0, "Queued",
			1000, 1, 1001, nil, []byte(`{}`), nil, nil, nil, false, now, nil, nil,
		))

	e := echo.New()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ml/retrain", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userRole", "moderator")
	context.Set("adminUserId", 17)
	if err := createMLRetrainingRun(context, db); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusAccepted, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateMLRetrainingRunRejectsConcurrentRun(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("INSERT INTO ml_training_runs").
		WithArgs(nil, "admin", baselineTrainingRows).
		WillReturnError(&pgconn.PgError{Code: "23505"})

	e := echo.New()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ml/retrain", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.Set("userRole", "admin")
	context.Set("adminUserId", 0)
	if err := createMLRetrainingRun(context, db); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
