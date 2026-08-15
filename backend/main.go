package main

import (
	"database/sql" //needed for *sql.DB type used in the real health check (rawDB.Ping())
	"log"          //logging errors and important events
	"os"           //provide platform independent interface

	//"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"            //echo main framework
	"github.com/labstack/echo/v4/middleware" //middleware parts
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"transcendence/modules/user"
	"transcendence/modules/user/auth"
	"transcendence/modules/user/chat"
	"transcendence/modules/user/friends"
	"transcendence/modules/user/notifications"
	"transcendence/modules/user/profile"
	"transcendence/myMiddleware"
)

func main() {
	//load .env file if no env loaded by docker. since we already use dockercompose to upload things from .env file to env. we only take from the existing env
	// err := godotenv.Load()
	// if err != nil {
	// 	log.Fatalf("Error loading .env file") //logs info, print str, and exit
	// }

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
	v1.GET("/status", statusHandler)
	// ai chat route, this is a public route, no auth required, but if the user is logged in, then we will pass the userId and authToken to the AI chat service
	v1.POST("/ai/chat", func(c echo.Context) error { return handleAIChat(c, rawDB) })

	// Product routes
	v1.GET("/products", func(c echo.Context) error { return getProducts(c, gormDB) })
	v1.GET("/products/:id", func(c echo.Context) error { return getProductByID(c, gormDB) })
	v1.GET("/products/:id/files", func(c echo.Context) error { return listListingFiles(c, gormDB) })
	v1.GET("/files/:fileId/content", func(c echo.Context) error { return serveListingFile(c, gormDB) })
	v1.GET("/products/:id/reviews", func(c echo.Context) error { return getListingReviews(c, gormDB) })

	// protected product routes
	// concatenate for example "/api/v1" + "/product" = "/api/v1/products"
	protected := e.Group("/api/v1")
	protected.Use(myMiddleware.JWTAuth(rawDB))

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
	stripeConfig := loadStripeConfigFromEnv()
	stripePayments := newStripePaymentService(
		rawDB,
		stripeConfig,
		newRealStripeCheckoutClient(stripeConfig.SecretKey),
	)
	stripeWebhooks := newStripeWebhookService(rawDB, stripeConfig, notificationService)
	v1.POST("/webhooks/stripe", func(c echo.Context) error {
		return handleStripeWebhook(c, stripeWebhooks)
	})
	go chatHub.Run()
	chatHandler := chat.NewHandler(chatHub, chatRepo, authService)
	chatHandler.Notifications = notificationService
	friendsHandler.Notifications = notificationService

	// protected means this route is logged-in only
	// this is to create new products, will be concatenate with the /api/v1/ as suffix
	// when a post request to /api/v1/products reach echo
	// then it will call this createProduct handler
	protected.POST("/products", func(c echo.Context) error { return createProduct(c, gormDB) })
	protected.POST("/products/import", func(c echo.Context) error { return importProducts(c, gormDB) })
	protected.PUT("/products/:id", func(c echo.Context) error { return updateProduct(c, gormDB) })
	protected.DELETE("/products/:id", func(c echo.Context) error { return deleteProduct(c, gormDB) })
	protected.POST("/products/:id/files", func(c echo.Context) error { return uploadListingFiles(c, gormDB) })
	protected.DELETE("/products/:id/files/:fileId", func(c echo.Context) error {
		return deleteListingFile(c, gormDB)
	})
	protected.GET("/products/:id/review-eligibility", func(c echo.Context) error { return getListingReviewEligibility(c, gormDB) })
	protected.POST("/products/:id/reviews", func(c echo.Context) error {
		return createListingReview(c, gormDB, notificationService)
	})

	protected.POST("/orders", func(c echo.Context) error {
		return createOrdersWithServices(c, gormDB, notificationService, stripePayments)
	})
	protected.GET("/orders", func(c echo.Context) error { return getOrders(c, gormDB) }) // howai AI maybe. merge residue 21 june
	protected.PUT("/orders/:id/complete", func(c echo.Context) error {
		return completeOrderWithNotifications(c, gormDB, notificationService)
	})
	protected.PUT("/orders/:id/cancel", func(c echo.Context) error { return cancelOrder(c, gormDB) })
	protected.GET("/orders/:id", func(c echo.Context) error { return getOrderByID(c, gormDB) }) //howai AI maybe. merge residue 21 june
	protected.GET("/orders/:id/recommendation-survey", func(c echo.Context) error {
		return getRecommendationSurvey(c, gormDB)
	})
	protected.POST("/orders/:id/recommendation-survey", func(c echo.Context) error {
		return createRecommendationSurvey(c, gormDB)
	})

	// Seller dashboard routes
	protected.GET("/seller/orders", func(c echo.Context) error { return getSellerOrders(c, gormDB) })
	protected.GET("/seller/dashboard/items", func(c echo.Context) error { return getSellerDashboardItems(c, gormDB) })
	protected.GET("/seller/dashboard/summary", func(c echo.Context) error { return getSellerDashboardSummary(c, gormDB) })
	protected.GET("/seller/dashboard/categories", func(c echo.Context) error { return getSellerDashboardCategories(c, gormDB) })

	// API key management (JWT-authed): generate/list/revoke keys, view request logs
	protected.POST("/api-keys", func(c echo.Context) error { return createAPIKey(c, gormDB) })
	protected.GET("/api-keys", func(c echo.Context) error { return listAPIKeys(c, gormDB) })
	protected.DELETE("/api-keys/:id", func(c echo.Context) error { return revokeAPIKey(c, gormDB) })
	protected.GET("/api-keys/logs", func(c echo.Context) error { return getAPIKeyLogs(c, gormDB) })

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
	public.GET("/products", func(c echo.Context) error { return getProductsForAPIKey(c, gormDB) })
	public.GET("/products/:id", func(c echo.Context) error { return getProductByIDForAPIKey(c, gormDB) })
	public.POST("/products", func(c echo.Context) error { return createProduct(c, gormDB) })
	// Its own handler, not the JWT route's: the web edit form replaces a whole
	// listing, while this surface stays a narrow six-field patch.
	public.PUT("/products/:id", func(c echo.Context) error { return updateProductForAPIKey(c, gormDB) })
	public.DELETE("/products/:id", func(c echo.Context) error { return deleteProduct(c, gormDB) })

	// Register routes
	authHandler.RegisterRoutes(v1)
	protected.POST("/auth/change-password/request", authHandler.RequestPasswordChange)
	protected.POST("/auth/change-password/confirm", authHandler.ConfirmPasswordChange)
	profileHandler.RegisterRoutes(v1)
	friendsHandler.RegisterRoutes(v1)
	chatHandler.RegisterRoutes(v1)
	notificationHandler.RegisterRoutes(v1)
	registerAdminRoutes(v1, rawDB)

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

// dummy statushandler
func statusHandler(c echo.Context) error {
	return c.JSON(200, map[string]interface{}{
		"status":  "running", //the map element
		"version": "1.0.0",
	})
}
