package main

import (
	"database/sql" //needed for *sql.DB type used in the real health check (rawDB.Ping())
	"log"          //logging errors and important events
	"os"           //provide platform independent interface

	"github.com/labstack/echo/v4"            //echo main framework
	"github.com/labstack/echo/v4/middleware" //middleware parts
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"transcendence/modules/admin"
	"transcendence/modules/ai"
	"transcendence/modules/apikey"
	"transcendence/modules/listing"
	listingfiles "transcendence/modules/listing/files"
	"transcendence/modules/listing/importcsv"
	"transcendence/modules/listing/reviews"
	"transcendence/modules/order"
	"transcendence/modules/order/dashboard"
	"transcendence/modules/order/survey"
	"transcendence/modules/user"
	"transcendence/modules/user/auth"
	"transcendence/modules/user/chat"
	"transcendence/modules/user/friends"
	"transcendence/modules/user/notifications"
	"transcendence/modules/user/profile"
	"transcendence/myMiddleware"
)

func main() {
	if err := auth.ConfigureJWTSecretFromEnv(); err != nil {
		log.Fatalf("Invalid auth configuration: %v", err)
	}

	//initialize database
	rawDB, gormDB, cleanup, err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	defer cleanup() //run the line before exiting fx

	//create echo instance
	e := echo.New()

	//middleware. run things pre/post route handler
	e.Use(middleware.Logger())  //log every incoming process
	e.Use(middleware.Recover()) //recover will prevent panick to affect all healthy threads. it only panick current threads
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"http://localhost:3000", "http://localhost", "https://localhost"}, //only allow from these origins
		AllowMethods: []string{"GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"},       //only allow from these methods
	}))

	//routes
	e.GET("/health", func(c echo.Context) error { return healthCheckHandler(c, rawDB) })
	e.GET("/metrics", echo.WrapHandler(promhttp.Handler()))
	v1 := e.Group("/api/v1")

	// Shared user, real-time, and notification services. Notifications reuse
	// the authenticated chat WebSocket rather than opening a second connection.
	baseRepo := user.NewRepository(rawDB, gormDB)
	authService := auth.NewService(baseRepo)
	authHandler := auth.NewHandler(baseRepo, authService)
	profileService := profile.NewService(baseRepo)
	profileHandler := profile.NewHandler(baseRepo, profileService)
	friendsRepo := friends.NewRepository(baseRepo)
	friendsHandler := friends.NewHandler(friendsRepo, authService)
	chatRepo := chat.NewRepository(baseRepo)
	chatHub := chat.NewHub(chatRepo)
	notificationRepo := notifications.NewRepository(rawDB)
	notificationService := notifications.NewService(notificationRepo)
	notificationService.Publisher = chatHub.SendPrivateMessage
	notificationHandler := notifications.NewHandler(notificationService)
	chatRepo.Notifications = notificationRepo
	chatHub.Notifications = notificationService
	stripeConfig := order.LoadStripeConfigFromEnv()
	stripePayments := order.NewStripePaymentService(
		rawDB,
		stripeConfig,
		order.NewRealStripeCheckoutClient(stripeConfig.SecretKey),
	)
	stripeWebhooks := order.NewStripeWebhookService(rawDB, stripeConfig, notificationService)
	v1.POST("/webhooks/stripe", func(c echo.Context) error {
		return order.HandleStripeWebhook(c, stripeWebhooks)
	})
	go chatHub.Run()
	chatHandler := chat.NewHandler(chatHub, chatRepo, authService)
	chatHandler.Notifications = notificationService
	friendsHandler.Notifications = notificationService

	listingHandler := listing.NewHandler(gormDB, rawDB)
	listingFilesHandler := listingfiles.NewHandler(gormDB, rawDB)
	listingReviewsHandler := reviews.NewHandler(gormDB, rawDB, notificationService)
	listingImportHandler := importcsv.NewHandler(gormDB, rawDB)
	orderHandler := order.NewHandler(gormDB, rawDB, notificationService, stripePayments)
	dashboardHandler := dashboard.NewHandler(gormDB, rawDB)
	surveyHandler := survey.NewHandler(gormDB, rawDB)
	apiKeyHandler := apikey.NewHandler(gormDB, rawDB)
	adminHandler := admin.NewHandler(rawDB)
	aiHandler := ai.NewHandler(rawDB)

	listingHandler.RegisterRoutes(v1)
	listingFilesHandler.RegisterRoutes(v1)
	listingReviewsHandler.RegisterRoutes(v1)
	listingImportHandler.RegisterRoutes(v1)
	orderHandler.RegisterRoutes(v1)
	dashboardHandler.RegisterRoutes(v1)
	surveyHandler.RegisterRoutes(v1)
	apiKeyHandler.RegisterRoutes(v1)
	aiHandler.RegisterRoutes(v1)

	// ─── PUBLIC DEVELOPER API ────────────────────────────────────────────────
	//
	// A key-authenticated REST surface over the products table, separate from
	// the browser-facing /api/v1 group. Five endpoints covering all four verbs:
	//
	//	GET    /api/public/v1/products          list / search listings
	//	GET    /api/public/v1/products/:id      fetch one listing
	//	POST   /api/public/v1/products          create a listing
	//	PUT    /api/public/v1/products/:id      update a listing
	//	DELETE /api/public/v1/products/:id      delete a listing
	//
	// Bulk CSV import is deliberately NOT here. It stays a web-UI feature on
	// the JWT group (POST /api/v1/products/import)
	public := e.Group("/api/public/v1")
	public.Use(myMiddleware.APIKeyAuth(rawDB))
	listingHandler.RegisterPublicAPI(public)

	// Register routes
	authHandler.RegisterRoutes(v1)
	// concatenate for example "/api/v1" + "/product" = "/api/v1/products"
	protected := e.Group("/api/v1")
	protected.Use(myMiddleware.JWTAuth(rawDB))
	protected.POST("/auth/change-password/request", authHandler.RequestPasswordChange)
	protected.POST("/auth/change-password/confirm", authHandler.ConfirmPasswordChange)
	profileHandler.RegisterRoutes(v1)
	friendsHandler.RegisterRoutes(v1)
	chatHandler.RegisterRoutes(v1)
	notificationHandler.RegisterRoutes(v1)
	adminHandler.RegisterRoutes(v1)

	//start server
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	e.Logger.Fatal(e.Start(":" + port)) //start is a function that enters infinite loop, wait, listens for http request. the port given should be in this format :XXXX
}

// healthCheckHandler does a REAL check, not just "server process is alive".
// Concept: a health check is only useful if it verifies the things this
// service actually depends on. Our backend is useless without the database,
// so we ping it here. If the ping fails, we return 503 (Service Unavailable)
// instead of 200 - this is what lets Docker's healthcheck, Prometheus's
// blackbox-exporter probe, and disaster-recovery scripts correctly detect
// "backend is up but broken" instead of just "backend process exists".
func healthCheckHandler(c echo.Context, rawDB *sql.DB) error {
	if err := rawDB.Ping(); err != nil {
		return c.JSON(503, map[string]interface{}{
			"status": "degraded",
			"db":     "unreachable",
			"error":  err.Error(),
		})
	}
	return c.JSON(200, map[string]interface{}{
		"status": "ok",
		"db":     "connected",
	})
}
