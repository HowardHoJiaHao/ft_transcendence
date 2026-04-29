package main

import (
	"database/sql" //postgres
	"fmt"
	"os"
	"log"

	_ "github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"transcendence/modules/user"
)

func initDB() (*sql.DB, *gorm.DB, func(), error) {
	rawDB, err := setupRaw()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("raw connection failed: %w", err)
	}

	ormDB, err := setupGORM(rawDB)
	if err != nil {
		rawDB.Close()
		return nil, nil, nil, fmt.Errorf("gorm setup failed: %w", err)
	}

	log.Println("Database connected successfully")

	cleanup := func() {
		log.Println("Cleanup: Closing database connections...")
		_ = rawDB.Close()
	}

	return rawDB, ormDB, cleanup, nil
}

func setupRaw() (*sql.DB, error) {
	//define environment configuration
	dbUser		:= os.Getenv("DB_USER")
	dbPassword	:= os.Getenv("DB_PASSWORD")
	dbHost		:= os.Getenv("DB_HOST")
	dbPort		:= os.Getenv("DB_PORT")
	dbName		:= os.Getenv("DB_NAME")

	//define the connection string. make it into this format "host=localhost port=5432 user=transcendence password=transcendence_pass dbname=transcendence sslmode=disable"
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName) //use sprintf to print the string into dsn variable

	//open the connection
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}

	//verify the connection
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}

	//connection pooling
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)

	return db, nil
}

func setupGORM(rawDB *sql.DB) (*gorm.DB, error) {
	//1st param postgres.Config{Conn: rawDB,} . gives existing db
	//2nd param &gorm.Config{} . empty for default settings
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: rawDB}), &gorm.Config{})
	if err != nil {
		_ = rawDB.Close()
		return nil, err
	}

	if err := user.AutoMigrate(gormDB); err != nil {
		_ = rawDB.Close()
		return nil, err
	}
	return gormDB, nil
}
