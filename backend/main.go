package main

import (
	"log" //logging errors and important events
	"os" //provide platform independent interface

	//"github.com/joho/godotenv"
	"github.com/labstack/echo/v4" //echo main framework
	"github.com/labstack/echo/v4/middleware" //middleware parts

	"transcendence/modules/user"
    "transcendence/modules/user/auth"
    "transcendence/modules/user/profile"
    "transcendence/modules/user/friends"
	"transcendence/modules/user/chat"
	authMiddleware "transcendence/middleware"
)

func main() {
	//load .env file if no env loaded by docker. since we already use dockercompose to upload things from .env file to env. we only take from the existing env
	// err := godotenv.Load()
	// if err != nil {
	// 	log.Fatalf("Error loading .env file") //logs info, print str, and exit
	// }

	//initialize database
	rawDB, gormDB, cleanup, err := initDB()
	if (err != nil) {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	defer cleanup() //run the line before exiting fx


	//create echo instance
	e := echo.New()

	//middleware. run things pre/post route handler
	e.Use(middleware.Logger()) //log every incoming process
	e.Use(middleware.Recover()) //recover will prevent panick to affect all healthy threads. it only panick current threads
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"http://localhost:3000", "http://localhost"}, //only allow from these origins
		AllowMethods: []string{"GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"}, //only allow from these methods
	}))

	//routes
	e.GET("/health", healthCheckHandler)
	v1 := e.Group("/api/v1")
	v1.GET("/status", statusHandler)

	// Product routes
	e.GET("/api/v1/products", func(c echo.Context) error { return getProducts(c, gormDB) })
	e.GET("/api/v1/products/:id", func(c echo.Context) error { return getProductByID(c, gormDB) })
	
	// protected product routes
	protected := e.Group("/api/v1")
	protected.Use(authMiddleware.JWTAuth())

	protected.POST("/products", func(c echo.Context) error { return createProduct(c, gormDB) })
	protected.DELETE("/products/:id", func(c echo.Context) error { return deleteProduct(c, gormDB) })
	protected.PUT("/products/:id", func(c echo.Context) error { return updateProduct(c, gormDB) })
	protected.POST("/products/:id/images", func(c echo.Context) error { return uploadListingImages(c, gormDB) })
	e.GET("/api/v1/products/:id/images", func(c echo.Context) error { return getListingImages(c, gormDB) })
	//User Module initialization
	baseRepo := user.NewRepository(rawDB, gormDB)

	// Initialize Auth module
	authService := auth.NewService(baseRepo)
	authHandler := auth.NewHandler(baseRepo, authService)

	// Initialize Profile module
	profileService := profile.NewService(baseRepo)
	profileHandler := profile.NewHandler(baseRepo, profileService)

	// Initialize Friends module
	friendsHandler := friends.NewHandler(baseRepo)

	// Initialize Chat module
	chatRepo := chat.NewRepository(baseRepo)
	chatHub := chat.NewHub(chatRepo)
	go chatHub.Run()
	chatHandler := chat.NewHandler(chatHub, chatRepo, authService)

	// Register routes
	authHandler.RegisterRoutes(v1)
	profileHandler.RegisterRoutes(v1)
	friendsHandler.RegisterRoutes(v1)
	chatHandler.RegisterRoutes(v1)

	// serve static files (avatars) from ./static mapped to /static URL
	e.Static("/static", "static")

	//start server 
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	e.Logger.Fatal(e.Start(":" + port)) //start is a function that enters infinite loop, wait, listens for http request. the port given should be in this format :XXXX
}

func healthCheckHandler(c echo.Context) error { //everytime a user enter /health give type echo.context to c
	return c.JSON(200, map[string]interface{}{ //use a helper of echo context that take the data and change into json string. gives 200 error status. and declare a map with key(string) and value (can be any type). interface means can be any type
		"status": "ok",
	})
}

func statusHandler(c echo.Context) error {
	return c.JSON(200, map[string]interface{}{
		"status": "running", //the map element
		"version": "1.0.0",
	})
}
