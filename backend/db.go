package main

import (
	"database/sql" //postgres
	"fmt"
	"os"
	"log"

	_"github.com/lib/pq"
)

func initDB() (*sql.DB, error) {
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
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}

	//verify connection. check the entered env is correct or not
	err = db.Ping()
	if err != nil {
		return nil, err
	}

	//connection pooling
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)

	log.Println("Database connected successfully")
	return db, nil
}
