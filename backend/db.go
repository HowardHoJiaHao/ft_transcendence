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

	if err := runListingFilesMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("listing files migration failed: %w", err)
	}

	if err := runAnalyticsEventsMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("analytics_events migration failed: %w", err)
	}

	if err := runUsersMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("users migration failed: %w", err)
	}

	if err := runNotificationsMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("notifications migration failed: %w", err)
	}

	if err := runPaymentsMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("payments migration failed: %w", err)
	}

	if err := runListingReviewsMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("listing reviews migration failed: %w", err)
	}

	if err := runRelationalIntegrityMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("relational integrity migration failed: %w", err)
	}

	if err := runMLTrainingMigration(rawDB); err != nil {
		_ = rawDB.Close()
		return nil, nil, nil, fmt.Errorf("ML training migration failed: %w", err)
	}

	log.Println("Database connected successfully")

	cleanup := func() {
		log.Println("Cleanup: Closing database connections...")
		_ = rawDB.Close()
	}

	return rawDB, ormDB, cleanup, nil
}

func runPaymentsMigration(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS payments (
			id BIGSERIAL PRIMARY KEY,
			checkout_request_id UUID NOT NULL,
			stripe_idempotency_key VARCHAR(255) NOT NULL,
			buyer_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
			seller_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
			provider VARCHAR(20) NOT NULL,
			currency CHAR(3) NOT NULL,
			amount_minor BIGINT NOT NULL,
			platform_fee_minor BIGINT NOT NULL,
			status VARCHAR(20) NOT NULL,
			stripe_checkout_session_id TEXT,
			stripe_checkout_url TEXT,
			stripe_payment_intent_id TEXT,
			session_expires_at TIMESTAMP,
			stock_released BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT payments_checkout_request_unique UNIQUE (checkout_request_id),
			CONSTRAINT payments_stripe_idempotency_unique UNIQUE (stripe_idempotency_key),
			CONSTRAINT payments_provider_check CHECK (provider = 'stripe'),
			CONSTRAINT payments_currency_check CHECK (currency = 'myr'),
			CONSTRAINT payments_amount_check CHECK (amount_minor > 0),
			CONSTRAINT payments_fee_check CHECK (
				platform_fee_minor >= 0 AND platform_fee_minor <= amount_minor
			),
			CONSTRAINT payments_status_check CHECK (
				status IN ('initializing', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')
			)
		)`,
		`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id BIGINT`,
		`DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_id_fkey'
			) THEN
				ALTER TABLE orders
					ADD CONSTRAINT orders_payment_id_fkey
					FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
			END IF;
		END $$`,
		`CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_buyer_created
			ON payments(buyer_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_seller_status_created
			ON payments(seller_id, status, created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_session_unique
			ON payments(stripe_checkout_session_id)
			WHERE stripe_checkout_session_id IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_intent_unique
			ON payments(stripe_payment_intent_id)
			WHERE stripe_payment_intent_id IS NOT NULL`,
		`CREATE TABLE IF NOT EXISTS stripe_webhook_events (
			stripe_event_id TEXT PRIMARY KEY,
			event_type TEXT NOT NULL,
			stripe_object_id TEXT,
			processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Payments migration completed")
	return nil
}

func runUsersMigration(db *sql.DB) error {
	migrations := []string{
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active'`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id VARCHAR(255)`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50)`,
		`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,
		`DO $$
		BEGIN
			ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
			ALTER TABLE users ADD CONSTRAINT users_account_status_check
				CHECK (account_status IN ('active', 'suspended', 'deleted'));
		END $$`,
		`DO $$
		BEGIN
			ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
			ALTER TABLE users ADD CONSTRAINT users_role_check
				CHECK (role IN ('user', 'moderator', 'admin'));
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
		// Listings gained a 'pending' state: checkout reserves the listing and
		// only a delivered order makes it 'sold'. Existing volumes carry the
		// old three-value CHECK that Postgres auto-named listings_status_check,
		// so it is replaced with an explicitly named one that allows the fourth.
		`DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'listings_status_check'
				  AND conrelid = 'listings'::regclass
			) THEN
				ALTER TABLE listings DROP CONSTRAINT listings_status_check;
			END IF;
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'listings_status_allowed'
				  AND conrelid = 'listings'::regclass
			) THEN
				ALTER TABLE listings
				ADD CONSTRAINT listings_status_allowed
				CHECK (status IN ('active', 'pending', 'sold', 'archived'));
			END IF;
		END $$`,
		// The original two Unsplash seed URLs now return 404. Update existing
		// volumes as well as fresh databases seeded from db/init.sql.
		`UPDATE listings
		 SET image = 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80'
		 WHERE image = 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop'`,
		`UPDATE listings
		 SET image = 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80'
		 WHERE image = 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop'`,
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Listings migration completed")
	return nil
}

func runListingFilesMigration(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS listing_files (
			id BIGSERIAL PRIMARY KEY,
			listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
			original_name VARCHAR(255) NOT NULL,
			storage_name VARCHAR(255) NOT NULL UNIQUE,
			file_kind VARCHAR(20) NOT NULL CHECK (file_kind IN ('image', 'document')),
			mime_type VARCHAR(100) NOT NULL,
			size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
			display_order INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_listing_files_listing_order
			ON listing_files(listing_id, file_kind, display_order, id)`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Listing files migration completed")
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

func runNotificationsMigration(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS notifications (
			id BIGSERIAL PRIMARY KEY,
			user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			actor_id INT REFERENCES users(id) ON DELETE SET NULL,
			notification_type VARCHAR(40) NOT NULL,
			resource_id INT,
			data JSONB NOT NULL DEFAULT '{}'::jsonb,
			read_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check`,
		`ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
			CHECK (notification_type IN ('message', 'friend_added', 'order_new', 'order_completed', 'review_added'))`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_user_order
		 ON notifications(user_id, updated_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
		 ON notifications(user_id, updated_at DESC, id DESC)
		 WHERE read_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unread_message_group
		 ON notifications(user_id, actor_id, notification_type)
		 WHERE read_at IS NULL AND notification_type = 'message'`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Notifications migration completed")
	return nil
}

func runListingReviewsMigration(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS listing_reviews (
			id BIGSERIAL PRIMARY KEY,
			listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
			reviewer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			order_id INT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
			rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
			comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 1000),
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT listing_reviews_listing_reviewer_unique UNIQUE (listing_id, reviewer_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_listing_reviews_listing_newest
			ON listing_reviews(listing_id, created_at DESC, id DESC)`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Listing reviews migration completed")
	return nil
}

// runRelationalIntegrityMigration brings existing volumes in line with the
// relationships db/init.sql now declares: orders survive listing deletion, the
// audit and analytics tables actually reference what they claim to, and the
// superseded seller-review table is gone.
func runRelationalIntegrityMigration(db *sql.DB) error {
	migrations := []string{
		// An order is financial history for buyer and seller alike. Cascading
		// from listings let a seller delete a listing and silently erase the
		// buyer's purchase record along with the revenue it contributed.
		`DO $$
		DECLARE
			constraint_name TEXT;
		BEGIN
			SELECT conname INTO constraint_name
			FROM pg_constraint
			WHERE conrelid = 'orders'::regclass
			  AND contype = 'f'
			  AND confrelid = 'listings'::regclass;
			IF constraint_name IS NOT NULL AND
			   (SELECT confdeltype FROM pg_constraint WHERE conname = constraint_name
			      AND conrelid = 'orders'::regclass) <> 'r' THEN
				EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', constraint_name);
			END IF;
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'orders_listing_id_restrict'
				  AND conrelid = 'orders'::regclass
			) THEN
				ALTER TABLE orders
				ADD CONSTRAINT orders_listing_id_restrict
				FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE RESTRICT;
			END IF;
		END $$`,

		// analytics_events.listing_id and the api_request_logs columns were
		// plain integers, free to hold ids of rows that no longer exist.
		// Orphans are nulled first, otherwise adding the key would fail.
		`UPDATE analytics_events SET listing_id = NULL
		 WHERE listing_id IS NOT NULL
		   AND listing_id NOT IN (SELECT id FROM listings)`,
		`DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'analytics_events_listing_fk'
				  AND conrelid = 'analytics_events'::regclass
			) THEN
				ALTER TABLE analytics_events
				ADD CONSTRAINT analytics_events_listing_fk
				FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL;
			END IF;
		END $$`,

		`UPDATE api_request_logs SET api_key_id = NULL
		 WHERE api_key_id IS NOT NULL
		   AND api_key_id NOT IN (SELECT id FROM api_keys)`,
		`UPDATE api_request_logs SET user_id = NULL
		 WHERE user_id IS NOT NULL
		   AND user_id NOT IN (SELECT id FROM users)`,
		// SET NULL, not CASCADE: revoking a key or deleting a user must not
		// erase the audit trail of what that key already did.
		`DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'api_request_logs_api_key_fk'
				  AND conrelid = 'api_request_logs'::regclass
			) THEN
				ALTER TABLE api_request_logs
				ADD CONSTRAINT api_request_logs_api_key_fk
				FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;
			END IF;
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'api_request_logs_user_fk'
				  AND conrelid = 'api_request_logs'::regclass
			) THEN
				ALTER TABLE api_request_logs
				ADD CONSTRAINT api_request_logs_user_fk
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
			END IF;
		END $$`,

		// Superseded by listing_reviews and referenced by no code at all;
		// leaving it invites someone to write against the wrong table.
		`DROP TABLE IF EXISTS reviews`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("Relational integrity migration completed")
	return nil
}

func runMLTrainingMigration(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS recommendation_training_feedback (
			id BIGSERIAL PRIMARY KEY,
			order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
			buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			age_group VARCHAR(32) NOT NULL CHECK (
				age_group IN ('under_13', '13-17', '18-25', '26-35', '36-45', '46_plus')
			),
			gender VARCHAR(32) NOT NULL CHECK (
				gender IN ('male', 'female', 'prefer_not_to_say')
			),
			experience_level VARCHAR(32) NOT NULL CHECK (
				experience_level IN (
					'less_than_6_months', '6_months_1_year', '1-3_years',
					'3-5_years', 'more_than_5_years'
				)
			),
			play_style VARCHAR(32) NOT NULL CHECK (
				play_style IN ('attacking', 'defensive', 'balanced', 'not_sure')
			),
			budget_range VARCHAR(32) NOT NULL CHECK (
				budget_range IN ('under_200', '200-400', '400-700', '700_plus')
			),
			weight_category VARCHAR(32) NOT NULL CHECK (
				weight_category IN ('1U', '2U', '3U', '4U', '5U', '6U', '7U', '8U')
			),
			flexibility_category VARCHAR(32) NOT NULL CHECK (
				flexibility_category IN ('Stiff Shaft', 'Medium Flex', 'High Flexibility')
			),
			balance_category VARCHAR(32) NOT NULL CHECK (
				balance_category IN ('Head Heavy', 'Even Balance', 'Head Light')
			),
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_newest
			ON recommendation_training_feedback(created_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS ml_training_runs (
			id BIGSERIAL PRIMARY KEY,
			requested_by INT REFERENCES users(id) ON DELETE SET NULL,
			requested_by_role VARCHAR(20) NOT NULL CHECK (
				requested_by_role IN ('moderator', 'admin')
			),
			status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (
				status IN ('queued', 'running', 'succeeded', 'failed')
			),
			progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
			stage VARCHAR(100) NOT NULL DEFAULT 'Queued',
			synthetic_rows INT NOT NULL DEFAULT 0 CHECK (synthetic_rows >= 0),
			survey_rows INT NOT NULL DEFAULT 0 CHECK (survey_rows >= 0),
			total_rows INT NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
			model_version VARCHAR(100),
			metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
			dataset_sha256 CHAR(64),
			artifact_sha256 CHAR(64),
			error_message VARCHAR(500),
			is_active BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			started_at TIMESTAMPTZ,
			finished_at TIMESTAMPTZ
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_training_runs_one_in_progress
			ON ml_training_runs ((1)) WHERE status IN ('queued', 'running')`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_training_runs_one_active
			ON ml_training_runs ((1)) WHERE is_active`,
		`CREATE INDEX IF NOT EXISTS idx_ml_training_runs_newest
			ON ml_training_runs(created_at DESC, id DESC)`,
	}
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	log.Println("ML training migration completed")
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
