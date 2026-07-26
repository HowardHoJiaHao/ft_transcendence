package main

import (
	"database/sql" //postgres
	"fmt"
	"log"
	"os"

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

	if err := runListingsMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("listings migration failed: %w", err)
	}

	if err := runAnalyticsEventsMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("analytics_events migration failed: %w", err)
	}

	if err := runUsersMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("users migration failed: %w", err)
	}

	log.Println("Database connected successfully")

	cleanup := func() {
		log.Println("Cleanup: Closing database connections...")
		_ = rawDB.Close()
	}

	return rawDB, ormDB, cleanup, nil
}

func runUsersMigration(db *sql.DB) error {
	migrations := []string{
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active'`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id VARCHAR(255)`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50)`,
		`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,
		`DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_check') THEN
				ALTER TABLE users ADD CONSTRAINT users_account_status_check CHECK (account_status IN ('active', 'suspended'));
			END IF;
		END $$`,
		`DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_check') THEN
				ALTER TABLE users ADD CONSTRAINT users_auth_check CHECK (
					password_hash IS NOT NULL
					OR (oauth_id IS NOT NULL AND oauth_provider IS NOT NULL)
				);
			END IF;
		END $$`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_identity
		 ON users(oauth_provider, oauth_id)
		 WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Users migration completed")
	return nil
}

// just to try use runlistingsmigration
func runListingsMigration(db *sql.DB) error {
	migrations := []string{
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'Others'`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS condition VARCHAR(50) DEFAULT 'Second-hand (Used)'`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS dealing_method VARCHAR(100) DEFAULT 'Meet Up'`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20) DEFAULT ''`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS stock_quantity INT NOT NULL DEFAULT 1`,
		`DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'listings_stock_quantity_nonnegative'
			) THEN
				ALTER TABLE listings
				ADD CONSTRAINT listings_stock_quantity_nonnegative
				CHECK (stock_quantity >= 0);
			END IF;
		END $$`,
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Listings migration completed")
	return nil
}

func runAnalyticsEventsMigration(db *sql.DB) error {
	migrations := []string{
		`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS listing_id INT`,
		`CREATE INDEX IF NOT EXISTS idx_analytics_events_listing_id ON analytics_events(listing_id)`,
		`CREATE TABLE IF NOT EXISTS api_request_logs (
			id SERIAL PRIMARY KEY,
			api_key_id INT,
			user_id INT,
			method VARCHAR(10),
			path VARCHAR(255),
			status INT,
			ip_address VARCHAR(64),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_api_request_logs_key ON api_request_logs(api_key_id, created_at)`,
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("analytics_events migration completed")
	return nil
}

func setupRaw() (*sql.DB, error) {
	//define environment configuration
	dbUser := os.Getenv("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")
	dbHost := os.Getenv("DB_HOST")
	dbPort := os.Getenv("DB_PORT")
	dbName := os.Getenv("DB_NAME")

	// Build the PostgreSQL connection string from runtime environment values.
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
