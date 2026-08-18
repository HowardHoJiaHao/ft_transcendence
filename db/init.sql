-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, --primary key means the official address of row w/ characteristics of unique and cannot be NULL
    username VARCHAR(255) UNIQUE NOT NULL, --not null means columns are mandatory
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    first_name VARCHAR(50),
    last_name VARCHAR(50),
	phone_no VARCHAR(30),
	-- Where this account's orders get delivered. One per account, edited from
	-- the profile page. Shown to the SELLER on a pending order so they know
	-- where to send the item, and to nobody else — it is never part of a public
	-- profile or listing response.
	address VARCHAR(255),
	postcode VARCHAR(5),
	state VARCHAR(50),
	district VARCHAR(100),
	date_of_birth DATE,
	gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
    -- The URL the frontend renders. For an uploaded avatar this is always
    -- /api/v1/users/<id>/avatar (a controlled endpoint), never a path under
    -- /static — nothing user-uploaded is served straight off disk. It may also
    -- hold an external URL for seeded or OAuth accounts.
    avatar_url VARCHAR(255),
    -- Generated filename inside storage/avatars/<user_id>/. Paired with
    -- avatar_mime_type, which is what the serving endpoint sends as
    -- Content-Type rather than trusting the file extension.
    avatar_storage_name VARCHAR(255),
    avatar_data BYTEA, -- legacy, unused: nothing writes it (see AGENTS notes)
    avatar_mime_type VARCHAR(50),
    bio TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    requires_2fa BOOLEAN DEFAULT FALSE,
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
    account_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deleted')),
    deleted_at TIMESTAMP,
    oauth_id VARCHAR(255),
    oauth_provider VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_auth_check CHECK (
        password_hash IS NOT NULL
        OR (oauth_id IS NOT NULL AND oauth_provider IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_identity
ON users(oauth_provider, oauth_id)
WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;

-- Create products/listings table
CREATE TABLE IF NOT EXISTS listings (
    id SERIAL PRIMARY KEY,
    seller_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    weight_category VARCHAR(100),
    flexibility_category VARCHAR(100),
	balance_category VARCHAR(100),
    category VARCHAR(100) DEFAULT 'Others' CHECK (
        category IN ('Rackets', 'Grips', 'Shuttlecocks', 'Racket Bags & Covers',
                     'Strings', 'Shoes', 'Apparel', 'Accessories', 'Others')
    ),
    condition VARCHAR(50) DEFAULT 'Second-hand (Used)',
    dealing_method VARCHAR(100) DEFAULT 'Meet Up',
    phone_number VARCHAR(20) DEFAULT '',
    price DECIMAL(10, 2) NOT NULL,
    original_price DECIMAL(10, 2),
    currency VARCHAR(10) DEFAULT 'RM',
    -- location holds the Malaysian district; state is its parent.
    location VARCHAR(100),
    state VARCHAR(50),
    image VARCHAR(255),
    seller_name VARCHAR(255),
    rating DECIMAL(3, 1) DEFAULT 4.5,
    reviews INT DEFAULT 0,
    is_new BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    stock_quantity INT NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0 AND stock_quantity <= 100),
    -- 'pending' is the window between checkout and the seller confirming
    -- delivery; only a delivered order makes a listing genuinely 'sold'.
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'sold', 'archived')),
    views_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ,
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE --if user deletes, product is deleted too
);

-- Create listing_images table
CREATE TABLE IF NOT EXISTS listing_images (
    id SERIAL PRIMARY KEY,
    listing_id INT NOT NULL,
    image_url VARCHAR(255),
    image_data BYTEA,
    mime_type VARCHAR(50),
    is_primary BOOLEAN DEFAULT FALSE, --the primary image to be shown first
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    CONSTRAINT listing_images_source_check CHECK (
        image_data IS NOT NULL
        OR (image_url IS NOT NULL AND btrim(image_url) <> '')
    ),
    CONSTRAINT listing_image_mime_check CHECK (
        image_data IS NULL
        OR (mime_type IS NOT NULL AND btrim(mime_type) <> '')
    )
);

-- Generic files attached to marketplace listings. Content is stored outside
-- the public static directory; this table contains only safe metadata and the
-- generated storage name used by the controlled file-serving endpoint.
CREATE TABLE IF NOT EXISTS listing_files (
    id BIGSERIAL PRIMARY KEY,
    listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    storage_name VARCHAR(255) NOT NULL UNIQUE,
    file_kind VARCHAR(20) NOT NULL CHECK (file_kind IN ('image', 'document')),
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listing_files_listing_order
ON listing_files(listing_id, file_kind, display_order, id);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The former seller-review table lived here. It was superseded by
-- listing_reviews below and referenced by no code, so it has been removed
-- rather than left as a second place reviews might be written.

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL,
    seller_id INT NOT NULL,
    listing_id INT NOT NULL,
    quantity INT DEFAULT 1,
    total_price DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'refunded')),
    payment_method VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ,
    FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: an order is financial history for both parties.
    -- Cascading would let a seller erase a buyer's purchase record, and the
    -- revenue the seller dashboard reports, just by deleting a listing.
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE RESTRICT
);

-- Demo-first supervised examples collected after checkout. The feature values
-- come from controlled survey options while the labels are snapshotted from
-- the purchased listing by the backend.
CREATE TABLE IF NOT EXISTS recommendation_training_feedback (
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
);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_newest
ON recommendation_training_feedback(created_at DESC, id DESC);

-- Durable queue and audit history for AI-service retraining work.
CREATE TABLE IF NOT EXISTS ml_training_runs (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_training_runs_one_in_progress
ON ml_training_runs ((1))
WHERE status IN ('queued', 'running');

CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_training_runs_one_active
ON ml_training_runs ((1))
WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_ml_training_runs_newest
ON ml_training_runs(created_at DESC, id DESC);

-- Stripe sandbox payments are separate from order fulfilment. One payment can
-- fund multiple same-seller order rows, while meetup and legacy orders remain
-- unlinked.
CREATE TABLE IF NOT EXISTS payments (
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
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_id_fkey'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_payment_id_fkey
            FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_buyer_created
ON payments(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_seller_status_created
ON payments(seller_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_session_unique
ON payments(stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_intent_unique
ON payments(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    stripe_object_id TEXT,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Product-specific reviews are intentionally separate from the older
-- seller-review table above. A completed buyer can review a listing once.
CREATE TABLE IF NOT EXISTS listing_reviews (
    id BIGSERIAL PRIMARY KEY,
    listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    reviewer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 1000),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT listing_reviews_listing_reviewer_unique UNIQUE (listing_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_reviews_listing_newest
ON listing_reviews(listing_id, created_at DESC, id DESC);

-- Create API keys table for authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    rate_limit INT DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Keys are short-lived on purpose: a leaked key stops working on its own.
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
    last_used_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit log for every public-API request made with an API key
CREATE TABLE IF NOT EXISTS api_request_logs (
    id SERIAL PRIMARY KEY,
    api_key_id INT,
    user_id INT,
    method VARCHAR(10),
    path VARCHAR(255),
    status INT,
    ip_address VARCHAR(64),
    -- Why the call ended the way it did. Rejected attempts are recorded too, so
    -- a run of invalid_key from one address is visible as the attack it is.
    outcome VARCHAR(32) NOT NULL DEFAULT 'success' CHECK (
        outcome IN ('success', 'missing_key', 'invalid_key',
                    'revoked_key', 'expired_key', 'rate_limited')
    ),
    user_agent VARCHAR(255),
    -- First 12 hex of the SHA-256 of the presented key. Enough to tell one key
    -- retried 500 times from 500 different keys tried once; not enough to be a
    -- credential, and one-way regardless.
    key_fingerprint VARCHAR(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- SET NULL rather than CASCADE: revoking a key or deleting a user must not
    -- erase the audit trail of what that key already did.
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_key
ON api_request_logs(api_key_id, created_at);

-- Drives the attack view: "which addresses are failing, and how often".
CREATE INDEX IF NOT EXISTS idx_api_request_logs_failures
ON api_request_logs(outcome, created_at DESC)
WHERE outcome <> 'success';

CREATE INDEX IF NOT EXISTS idx_api_request_logs_ip
ON api_request_logs(ip_address, created_at DESC);

-- Create friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    user_id1 INT NOT NULL,
    user_id2 INT NOT NULL,
    CONSTRAINT friendships_user_pair_unique UNIQUE (user_id1, user_id2),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id1) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id2) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, is_read);

-- Durable in-app notifications. Dynamic display text is rendered by the
-- frontend from notification_type + data so it can follow the selected locale.
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    actor_id INT,
    notification_type VARCHAR(40) NOT NULL CONSTRAINT notifications_type_check CHECK (
        notification_type IN ('message', 'friend_added', 'order_new', 'order_completed', 'review_added')
    ),
    resource_id INT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_order
ON notifications(user_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, updated_at DESC, id DESC)
WHERE read_at IS NULL;

-- Repeated unread messages from one sender update a single notification row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unread_message_group
ON notifications(user_id, actor_id, notification_type)
WHERE read_at IS NULL AND notification_type = 'message';

-- Seed sample users
INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified) VALUES
('ahmad_store', 'ahmad@example.com', 'hash1', 'Ahmad', 'Store', 'https://ui-avatars.com/api/?name=Ahmad+Store', TRUE),
('tech_hub', 'tech@example.com', 'hash2', 'Tech', 'Hub', 'https://ui-avatars.com/api/?name=Tech+Hub', TRUE),
('audio_pro', 'audio@example.com', 'hash3', 'Audio', 'Pro', 'https://ui-avatars.com/api/?name=Audio+Pro', TRUE),
('home_decor', 'home@example.com', 'hash4', 'Home', 'Decor', 'https://ui-avatars.com/api/?name=Home+Decor', TRUE),
('sports_gear', 'sports@example.com', 'hash5', 'Sports', 'Gear', 'https://ui-avatars.com/api/?name=Sports+Gear', TRUE),
('camera_kingdom', 'camera@example.com', 'hash6', 'Camera', 'Kingdom', 'https://ui-avatars.com/api/?name=Camera+Kingdom', TRUE),
('gaming_masters', 'gaming@example.com', 'hash7', 'Gaming', 'Masters', 'https://ui-avatars.com/api/?name=Gaming+Masters', TRUE),
('furniture_palace', 'furniture@example.com', 'hash8', 'Furniture', 'Palace', 'https://ui-avatars.com/api/?name=Furniture+Palace', TRUE),
('muhamadd', 'muhamadd@example.com', 'hash9', 'Muha', 'Mad', 'https://ui-avatars.com/api/?name=Muha+Mad', TRUE)
ON CONFLICT DO NOTHING;--handle logic do nothing for same thing & for double click problem

-- Seed sample products
INSERT INTO listings (seller_id, title, description, weight_category, flexibility_category, balance_category, price, original_price, location, image, seller_name, rating, reviews, is_new, is_featured, status) VALUES
(1, 'Yonex Astrox 99 Pro 3U', 'Power-focused racket with fast swing speed and strong rear-court attacks.', '3U', 'Stiff Shaft', 'Head Heavy', 780, 920, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Ahmad Store', 4.8, 156, FALSE, TRUE, 'active'),
(2, 'Victor Thruster K Falcon 4U', 'Balanced power and control, suitable for intermediate to advanced players.', '4U', 'Medium Flex', 'Even Balance', 620, NULL, 'Petaling Jaya', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Tech Hub', 4.9, 89, TRUE, TRUE, 'active'),
(3, 'Li-Ning Windstorm 72 5U', 'Ultra-light racket made for quick defense and rapid drives.', '5U', 'High Flexibility', 'Head Light', 430, 520, 'Shah Alam', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Audio Pro', 4.7, 234, FALSE, FALSE, 'active'),
(4, 'Apacs Z-Ziggler 2U', 'Solid frame for players who prefer extra mass and stability on smashes.', '2U', 'Stiff Shaft', 'Head Heavy', 350, NULL, 'Bangsar', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Home Decor Store', 4.6, 45, FALSE, FALSE, 'active'),
(5, 'Mizuno Altius 1U Training Racket', 'Heavy training racket to build swing strength and timing consistency.', '1U', 'Medium Flex', 'Head Heavy', 290, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Sports Gear', 4.5, 67, TRUE, FALSE, 'active'),
(6, 'Felet Woven 888 6U', 'Lightweight option for doubles defense and quick front-court exchanges.', '6U', 'High Flexibility', 'Head Light', 260, 320, 'Sentosa', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Camera Kingdom', 4.9, 178, FALSE, TRUE, 'active'),
(7, 'Kawasaki Hyper Nano 7U', 'Very light frame built for speed, great for beginner and junior players.', '7U', 'Medium Flex', 'Even Balance', 220, NULL, 'Cyberjaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Gaming Masters', 4.8, 124, TRUE, TRUE, 'active'),
(8, 'Fleet Nano Power 8U', 'Extremely agile racket for rapid net play and easy maneuverability.', '8U', 'High Flexibility', 'Head Light', 180, NULL, 'Mid Valley', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Furniture Palace', 4.4, 56, FALSE, FALSE, 'active'),
(9, 'Racket Pro Attack', 'Can smash with steep angle and strong follow-through. Ideal for attacking style.', '3U', 'Stiff Shaft', 'Head Heavy', 150, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Sport Master', 4.4, 56, TRUE, TRUE, 'active')
ON CONFLICT DO NOTHING;

-- Create analytics table
CREATE TABLE IF NOT EXISTS analytics (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    listing_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id)
);

CREATE TABLE IF NOT EXISTS faq_embeddings (
    id SERIAL PRIMARY KEY,
    source_file VARCHAR(255),
    chunk_text TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faq_embeddings_vector
ON faq_embeddings USING ivfflat (embedding vector_cosine_ops);

-- Versioned RacketBot knowledge base. The embedding column deliberately does
-- not hardcode a dimension: ingestion validates and records the dimension for
-- the configured embedding model before activating a new version.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    chunk_id VARCHAR(255) NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    source_file VARCHAR(255) NOT NULL,
    document_title TEXT NOT NULL,
    section_title TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    audience VARCHAR(50) NOT NULL DEFAULT 'all',
    last_reviewed VARCHAR(32),
    chunk_text TEXT NOT NULL,
    content_hash CHAR(64) NOT NULL,
    embedding_model VARCHAR(255) NOT NULL,
    embedding_dimension INT NOT NULL,
    ingestion_version VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector(
            'english',
            COALESCE(document_title, '') || ' ' ||
            COALESCE(section_title, '') || ' ' ||
            COALESCE(chunk_text, '')
        )
    ) STORED,
    embedding VECTOR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ingestion_version, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_active
ON knowledge_chunks (is_active, category);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_search
ON knowledge_chunks USING GIN (search_vector);

-- ============================================================
-- Demo seed: seller analytics dashboard data
-- Dates are relative to NOW() so the dashboard always shows a
-- recent-looking 8-month sales history.
-- ============================================================

-- Demo seller account: howardho992002@gmail.com / password "aaa" (bcrypt), 2FA off
INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified, requires_2fa) VALUES
('howard', 'howardho992002@gmail.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'howard', '', 'https://ui-avatars.com/api/?name=howard', TRUE, FALSE)
ON CONFLICT DO NOTHING;

-- Second demo account, for testing buyer/seller interactions between two logins.
-- Same password "aaa" — the bcrypt salt is carried inside the hash, so reusing
-- the digest gives the same password without needing a second one generated.
-- is_verified skips e-mail verification and requires_2fa off skips the OTP step.
INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified, requires_2fa) VALUES
('howard2', 'howardho992003@gmail.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'howard', '', 'https://ui-avatars.com/api/?name=howard2', TRUE, FALSE)
ON CONFLICT DO NOTHING;

-- Listings for ahmad_store (seller 1), ids 20-26
INSERT INTO listings (id, seller_id, title, description, category, condition, dealing_method, weight_category, flexibility_category, balance_category, price, original_price, location, image, seller_name, rating, reviews, is_new, is_featured, status, views_count, created_at, updated_at) VALUES
(20, 1, 'Victor Jetspeed S12', 'Fast attacking racket, lightly used.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Even Balance', 450, 550, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Ahmad Store', 4.7, 12, FALSE, FALSE, 'sold', 34, NOW() - INTERVAL '95 days', NOW() - INTERVAL '80 days'),
(21, 1, 'Yonex Mavis 350 Shuttlecocks (Tube of 6)', 'Unopened tube, nylon shuttlecocks.', 'Accessories', 'New', 'Delivery', '', '', '', 35, NULL, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Ahmad Store', 4.9, 8, TRUE, FALSE, 'sold', 21, NOW() - INTERVAL '70 days', NOW() - INTERVAL '66 days'),
(22, 1, 'Badminton Kit Bag - 6 Racket Capacity', 'Padded compartments, barely used.', 'Racket Bags & Covers', 'Second-hand (Used)', 'Meet Up', '', '', '', 120, 160, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Ahmad Store', 4.6, 5, FALSE, FALSE, 'sold', 18, NOW() - INTERVAL '55 days', NOW() - INTERVAL '50 days'),
(23, 1, 'Yonex Court Shoes SHB 65Z3 (US9)', 'Worn twice, like new condition.', 'Shoes', 'Second-hand (Used)', 'Meet Up', '', '', '', 220, 320, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Ahmad Store', 4.8, 9, FALSE, TRUE, 'sold', 40, NOW() - INTERVAL '38 days', NOW() - INTERVAL '30 days'),
(24, 1, 'Li-Ning Turbo X1 4U', 'Control-oriented racket, great for doubles.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Medium Flex', 'Even Balance', 390, NULL, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Ahmad Store', 4.5, 3, FALSE, FALSE, 'sold', 15, NOW() - INTERVAL '20 days', NOW() - INTERVAL '15 days'),
(25, 1, 'Grip Tape Bundle (5 pcs)', 'Assorted overgrips, mixed colors.', 'Accessories', 'New', 'Delivery', '', '', '', 25, NULL, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Ahmad Store', 4.4, 2, TRUE, FALSE, 'active', 9, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
(26, 1, 'Apacs Feather Weight X Speed', 'Ultra-light frame, needs restring.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '6U', 'High Flexibility', 'Head Light', 150, 210, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Ahmad Store', 4.3, 1, FALSE, FALSE, 'active', 62, NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- Listings for howard, ids 27-59
INSERT INTO listings (id, seller_id, title, description, category, condition, dealing_method, weight_category, flexibility_category, balance_category, price, original_price, location, image, seller_name, rating, reviews, is_new, is_featured, status, views_count, created_at, updated_at) VALUES
(27, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Nanoflare 800 Pro 4U', 'Speed-oriented racket, excellent condition.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Head Light', 890, 1050, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.8, 15, FALSE, TRUE, 'sold', 58, NOW() - INTERVAL '120 days', NOW() - INTERVAL '105 days'),
(28, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Thruster Ryuga II', 'Head-heavy power racket, minor scratches.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 520, 650, 'Subang Jaya', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'howard', 4.6, 9, FALSE, FALSE, 'sold', 41, NOW() - INTERVAL '110 days', NOW() - INTERVAL '98 days'),
(29, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'RSL Shuttlecocks (Tube of 12)', 'Feather shuttlecocks, tournament grade.', 'Accessories', 'New', 'Delivery', '', '', '', 60, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'howard', 4.9, 22, TRUE, FALSE, 'sold', 33, NOW() - INTERVAL '100 days', NOW() - INTERVAL '93 days'),
(30, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Adidas Court Stabil Shoes (US10)', 'Worn a handful of times, great grip.', 'Shoes', 'Second-hand (Used)', 'Meet Up', '', '', '', 260, 380, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.7, 11, FALSE, TRUE, 'sold', 47, NOW() - INTERVAL '90 days', NOW() - INTERVAL '80 days'),
(31, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Racket Bag (3-in-1)', 'Holds 3 rackets, side pocket for shoes.', 'Racket Bags & Covers', 'Second-hand (Used)', 'Meet Up', '', '', '', 95, 140, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.5, 6, FALSE, FALSE, 'sold', 29, NOW() - INTERVAL '85 days', NOW() - INTERVAL '77 days'),
(32, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Li-Ning Aeronaut 7000 Combat', 'Tournament racket, comes with new grip.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 610, 720, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.8, 13, FALSE, FALSE, 'sold', 52, NOW() - INTERVAL '75 days', NOW() - INTERVAL '65 days'),
(33, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Overgrip Bundle (10 pcs, assorted)', 'Mixed brands, unused.', 'Accessories', 'New', 'Delivery', '', '', '', 40, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'howard', 4.4, 4, TRUE, FALSE, 'sold', 19, NOW() - INTERVAL '65 days', NOW() - INTERVAL '59 days'),
(34, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Power Cushion 65 Z2 (US9)', 'Lightweight court shoes, good tread left.', 'Shoes', 'Second-hand (Used)', 'Meet Up', '', '', '', 230, 300, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'howard', 4.6, 8, FALSE, FALSE, 'sold', 36, NOW() - INTERVAL '55 days', NOW() - INTERVAL '48 days'),
(35, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Apacs Ziggler Speed 2U', 'Control frame, restrung last month.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '2U', 'Stiff Shaft', 'Head Heavy', 340, 420, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.5, 5, FALSE, FALSE, 'sold', 28, NOW() - INTERVAL '48 days', NOW() - INTERVAL '40 days'),
(36, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Wristband Set (4 pairs)', 'Sweat-absorbent, unused.', 'Accessories', 'New', 'Delivery', '', '', '', 18, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.3, 2, TRUE, FALSE, 'sold', 14, NOW() - INTERVAL '35 days', NOW() - INTERVAL '30 days'),
(37, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Astrox 88D Pro 3U', 'Doubles-focused racket, like new.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 780, 920, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.9, 17, FALSE, TRUE, 'active', 66, NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
(38, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor A960 Shuttlecocks (Tube of 6)', 'Nylon, durable for daily practice.', 'Accessories', 'New', 'Delivery', '', '', '', 28, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'howard', 4.4, 3, TRUE, FALSE, 'active', 22, NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
(39, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Mizuno Wave Fang Pro 2 (US9.5)', 'Premium court shoes, excellent cushioning.', 'Shoes', 'Second-hand (Used)', 'Meet Up', '', '', '', 310, 400, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'howard', 4.7, 7, FALSE, FALSE, 'active', 31, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
(40, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Felet TR Woven 7U', 'Ultra-light doubles racket, needs grip change.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '7U', 'High Flexibility', 'Head Light', 175, 240, 'Subang Jaya', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'howard', 4.2, 1, FALSE, FALSE, 'active', 44, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days'),
(41, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Sports Towel + Cap Combo', 'Quick-dry towel with matching cap.', 'Accessories', 'New', 'Delivery', '', '', '', 22, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'howard', 4.1, 1, TRUE, FALSE, 'archived', 6, NOW() - INTERVAL '150 days', NOW() - INTERVAL '140 days'),
(42, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Arcsaber 11 Pro 3U', 'All-round classic, well maintained.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 720, 850, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.8, 14, FALSE, FALSE, 'sold', 45, NOW() - INTERVAL '220 days', NOW() - INTERVAL '208 days'),
(43, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Brave Sword 12 SE', 'Legendary speed frame, grommets replaced.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Light', 480, 580, 'Subang Jaya', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'howard', 4.7, 10, FALSE, FALSE, 'sold', 38, NOW() - INTERVAL '210 days', NOW() - INTERVAL '195 days'),
(44, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'BG80 String Reel (200m)', 'Half-used reel, kept dry.', 'Strings', 'Second-hand (Used)', 'Meet Up', '', '', '', 180, 260, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'howard', 4.6, 6, FALSE, FALSE, 'sold', 20, NOW() - INTERVAL '200 days', NOW() - INTERVAL '190 days'),
(45, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Team Jacket (L)', 'Tournament jacket, worn once.', 'Apparel', 'Second-hand (Used)', 'Delivery', '', '', '', 90, 150, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.5, 4, FALSE, FALSE, 'sold', 16, NOW() - INTERVAL '190 days', NOW() - INTERVAL '178 days'),
(46, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Li-Ning Court Shorts (M) x2', 'Two pairs, excellent condition.', 'Apparel', 'Second-hand (Used)', 'Delivery', '', '', '', 45, 80, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.4, 3, FALSE, FALSE, 'sold', 12, NOW() - INTERVAL '175 days', NOW() - INTERVAL '162 days'),
(47, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor P9200 Shoes (US8.5)', 'Cushioned sole, good for wide feet.', 'Shoes', 'Second-hand (Used)', 'Meet Up', '', '', '', 190, 280, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'howard', 4.6, 7, FALSE, FALSE, 'sold', 27, NOW() - INTERVAL '170 days', NOW() - INTERVAL '155 days'),
(48, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Aerobite Hybrid String Set x5', 'Five packs, sealed.', 'Strings', 'New', 'Delivery', '', '', '', 110, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'howard', 4.7, 5, TRUE, FALSE, 'sold', 23, NOW() - INTERVAL '160 days', NOW() - INTERVAL '148 days'),
(49, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Astrox 77 Play 4U', 'Entry attacking racket, near new.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Medium Flex', 'Head Heavy', 260, 330, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.5, 4, FALSE, FALSE, 'sold', 31, NOW() - INTERVAL '150 days', NOW() - INTERVAL '138 days'),
(50, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Net + Posts (Portable)', 'Full set for driveway games.', 'Accessories', 'Second-hand (Used)', 'Meet Up', '', '', '', 140, 220, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'howard', 4.3, 2, FALSE, FALSE, 'sold', 17, NOW() - INTERVAL '140 days', NOW() - INTERVAL '128 days'),
(51, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Thruster F Enhanced', 'Singles powerhouse, fresh grip.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 550, 680, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.8, 11, FALSE, TRUE, 'sold', 49, NOW() - INTERVAL '130 days', NOW() - INTERVAL '118 days'),
(52, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Comfort Z3 Shoes (US10)', 'Top-tier shoes, light wear.', 'Shoes', 'Second-hand (Used)', 'Meet Up', '', '', '', 340, 480, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.9, 13, FALSE, TRUE, 'sold', 44, NOW() - INTERVAL '28 days', NOW() - INTERVAL '21 days'),
(53, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Exbolt 63 String Packs x8', 'Sealed, popular gauge.', 'Strings', 'New', 'Delivery', '', '', '', 150, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'howard', 4.6, 6, TRUE, FALSE, 'sold', 26, NOW() - INTERVAL '14 days', NOW() - INTERVAL '6 days'),
(54, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Li-Ning Tournament Shirt (M) x3', 'Three shirts, barely worn.', 'Apparel', 'Second-hand (Used)', 'Delivery', '', '', '', 60, 105, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.4, 3, FALSE, FALSE, 'sold', 19, NOW() - INTERVAL '9 days', NOW() - INTERVAL '3 days'),
(55, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Astrox 100ZZ 4U', 'Flagship attacking racket, kept mint.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Head Heavy', 950, 1150, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.9, 20, FALSE, TRUE, 'active', 12, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
(56, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Stringing Machine (Manual)', 'Hobbyist crank machine, works great.', 'Accessories', 'Second-hand (Used)', 'Meet Up', '', '', '', 850, 1300, 'Subang Jaya', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'howard', 4.5, 4, FALSE, FALSE, 'active', 8, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
(57, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Crown Collection Cap', 'Limited edition, tags on.', 'Apparel', 'New', 'Delivery', '', '', '', 55, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'howard', 4.2, 1, TRUE, FALSE, 'active', 5, NOW() - INTERVAL '50 days', NOW() - INTERVAL '50 days'),
(58, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Old Club Jersey Set (5 pcs)', 'Retired club jerseys, collector item.', 'Apparel', 'Second-hand (Used)', 'Meet Up', '', '', '', 75, 120, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.0, 1, FALSE, FALSE, 'archived', 11, NOW() - INTERVAL '130 days', NOW() - INTERVAL '95 days'),
(59, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Kason Vintage Racket (Display)', 'Wall display piece, not for play.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 200, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.1, 2, FALSE, FALSE, 'archived', 7, NOW() - INTERVAL '115 days', NOW() - INTERVAL '88 days')
ON CONFLICT DO NOTHING;

-- Extra dummy sellers so the recommendation catalog is not owned by one shop.
-- Same password as the howard demo accounts ("aaa") so they can be signed into
-- during local testing. IDs are resolved by username below because existing
-- volumes already have users beyond the original seed.
INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified, requires_2fa) VALUES
('smash_court', 'smash.court@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Smash', 'Court', 'https://ui-avatars.com/api/?name=Smash+Court', TRUE, FALSE),
('shuttle_station', 'shuttle.station@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Shuttle', 'Station', 'https://ui-avatars.com/api/?name=Shuttle+Station', TRUE, FALSE),
('racket_republic', 'racket.republic@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Racket', 'Republic', 'https://ui-avatars.com/api/?name=Racket+Republic', TRUE, FALSE),
('court_king', 'court.king@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Court', 'King', 'https://ui-avatars.com/api/?name=Court+King', TRUE, FALSE),
('feather_force', 'feather.force@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Feather', 'Force', 'https://ui-avatars.com/api/?name=Feather+Force', TRUE, FALSE),
('net_play', 'net.play@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Net', 'Play', 'https://ui-avatars.com/api/?name=Net+Play', TRUE, FALSE),
('smash_lab', 'smash.lab@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Smash', 'Lab', 'https://ui-avatars.com/api/?name=Smash+Lab', TRUE, FALSE),
('court_side', 'court.side@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Court', 'Side', 'https://ui-avatars.com/api/?name=Court+Side', TRUE, FALSE),
('ace_rackets', 'ace.rackets@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Ace', 'Rackets', 'https://ui-avatars.com/api/?name=Ace+Rackets', TRUE, FALSE),
('smash_depot', 'smash.depot@example.com', '$2a$10$B41tPZmXQszHGGHj6qwRNOX9V4eTDKw1JOVg0jbl2SFgtqmitanjS', 'Smash', 'Depot', 'https://ui-avatars.com/api/?name=Smash+Depot', TRUE, FALSE)
ON CONFLICT DO NOTHING;

-- 50 active racket listings (ids 60-109) covering the spec grid the
-- recommender searches: every weight class, all three shaft flexes, all three
-- balances, and all four budget bands. Left without orders so they stay
-- browseable after the stock-reconciliation UPDATE below.
INSERT INTO listings (id, seller_id, title, description, category, condition, dealing_method, weight_category, flexibility_category, balance_category, price, original_price, location, image, seller_name, rating, reviews, is_new, is_featured, status, stock_quantity, views_count, created_at, updated_at) VALUES
(60, (SELECT id FROM users WHERE username='smash_court'), 'Yonex Astrox 99 Game 3U', 'Attacking 3U with a stiff shaft and head-heavy smash angle.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 680, 850, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Smash Court', 4.8, 21, FALSE, TRUE, 'active', 1, 74, NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),
(61, (SELECT id FROM users WHERE username='smash_court'), 'Victor Thruster K Onigiri 3U', 'Stiff even-balance frame for controlled rear-court power.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Even Balance', 540, 690, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Smash Court', 4.6, 11, FALSE, FALSE, 'active', 1, 33, NOW() - INTERVAL '21 days', NOW() - INTERVAL '21 days'),
(62, (SELECT id FROM users WHERE username='smash_court'), 'Li-Ning Aeronaut 9000C 3U', 'Stiff head-light singles racket, fast recovery after clears.', 'Rackets', 'Second-hand (Used)', 'Mailing or Delivery', '3U', 'Stiff Shaft', 'Head Light', 720, 880, 'Petaling Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Smash Court', 4.7, 16, FALSE, FALSE, 'active', 1, 41, NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days'),
(63, (SELECT id FROM users WHERE username='smash_court'), 'Yonex Arcsaber 7 Pro 3U', 'Medium-flex head-heavy all-rounder, freshly gripped.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Head Heavy', 490, 610, 'Petaling Jaya', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Smash Court', 4.5, 8, FALSE, FALSE, 'active', 1, 27, NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
(64, (SELECT id FROM users WHERE username='smash_court'), 'Apacs Virtus 70 3U', 'Medium-flex even-balance club racket, good for mixed doubles.', 'Rackets', 'Refurbished', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 280, 360, 'Shah Alam', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Smash Court', 4.3, 5, FALSE, FALSE, 'active', 1, 19, NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
(65, (SELECT id FROM users WHERE username='shuttle_station'), 'Felet Woven TJ 3U', 'Medium-flex head-light frame for drive exchanges.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Head Light', 310, 390, 'Shah Alam', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Shuttle Station', 4.4, 7, FALSE, FALSE, 'active', 1, 22, NOW() - INTERVAL '11 days', NOW() - INTERVAL '11 days'),
(66, (SELECT id FROM users WHERE username='shuttle_station'), 'Kawasaki Honour S9 3U', 'Flexible head-heavy racket that helps late swing timing.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'High Flexibility', 'Head Heavy', 240, 310, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Shuttle Station', 4.2, 4, FALSE, FALSE, 'active', 1, 15, NOW() - INTERVAL '27 days', NOW() - INTERVAL '27 days'),
(67, (SELECT id FROM users WHERE username='shuttle_station'), 'Fleet Professional 3000 3U', 'Flexible even-balance beginner racket, almost unused.', 'Rackets', 'New', 'Mailing or Delivery', '3U', 'High Flexibility', 'Even Balance', 165, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Shuttle Station', 4.6, 9, TRUE, FALSE, 'active', 1, 38, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
(68, (SELECT id FROM users WHERE username='shuttle_station'), 'Carlton Airblade 3000 3U', 'Flexible head-light racket for junior-to-club doubles.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'High Flexibility', 'Head Light', 190, 250, 'Puchong', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Shuttle Station', 4.1, 3, FALSE, FALSE, 'active', 1, 12, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
(69, (SELECT id FROM users WHERE username='shuttle_station'), 'Yonex Astrox 88S Pro 4U', 'Stiff head-heavy doubles racket, steep smash trajectory.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Head Heavy', 860, 1040, 'Puchong', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Shuttle Station', 4.9, 24, FALSE, TRUE, 'active', 1, 81, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
(70, (SELECT id FROM users WHERE username='racket_republic'), 'Victor DriveX 9X 4U', 'Stiff even-balance all-rounder, restrung last week.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Even Balance', 610, 750, 'Bangsar', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Racket Republic', 4.7, 14, FALSE, FALSE, 'active', 1, 46, NOW() - INTERVAL '16 days', NOW() - INTERVAL '16 days'),
(71, (SELECT id FROM users WHERE username='racket_republic'), 'Yonex Nanoflare 700 Pro 4U', 'Stiff head-light speed racket for front-court interceptions.', 'Rackets', 'Second-hand (Used)', 'Mailing or Delivery', '4U', 'Stiff Shaft', 'Head Light', 790, 960, 'Bangsar', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Racket Republic', 4.8, 18, FALSE, TRUE, 'active', 1, 63, NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
(72, (SELECT id FROM users WHERE username='racket_republic'), 'Li-Ning Windstorm 79 4U', 'Medium-flex head-heavy attacking frame for intermediates.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Medium Flex', 'Head Heavy', 360, 450, 'Cheras', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Racket Republic', 4.5, 10, FALSE, FALSE, 'active', 1, 29, NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days'),
(73, (SELECT id FROM users WHERE username='racket_republic'), 'Mizuno Fortius 50 4U', 'Medium-flex even-balance control racket, tournament used twice.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Medium Flex', 'Even Balance', 520, 640, 'Cheras', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Racket Republic', 4.6, 12, FALSE, FALSE, 'active', 1, 35, NOW() - INTERVAL '13 days', NOW() - INTERVAL '13 days'),
(74, (SELECT id FROM users WHERE username='racket_republic'), 'Apacs Ziggler LHI 4U', 'Medium-flex head-light racket for defensive doubles.', 'Rackets', 'Refurbished', 'Meet Up', '4U', 'Medium Flex', 'Head Light', 270, 340, 'Kajang', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Racket Republic', 4.3, 6, FALSE, FALSE, 'active', 1, 18, NOW() - INTERVAL '35 days', NOW() - INTERVAL '35 days'),
(75, (SELECT id FROM users WHERE username='court_king'), 'Forza Power 688 4U', 'Flexible head-heavy power assist for club smashers.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'High Flexibility', 'Head Heavy', 210, 280, 'Kajang', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Court King', 4.2, 4, FALSE, FALSE, 'active', 1, 14, NOW() - INTERVAL '19 days', NOW() - INTERVAL '19 days'),
(76, (SELECT id FROM users WHERE username='court_king'), 'Yang Yang Blitz 4U', 'Flexible even-balance starter racket, factory grip still on.', 'Rackets', 'New', 'Mailing or Delivery', '4U', 'High Flexibility', 'Even Balance', 145, NULL, 'Damansara', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Court King', 4.4, 8, TRUE, FALSE, 'active', 1, 31, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
(77, (SELECT id FROM users WHERE username='court_king'), 'Kason Super Light 4U', 'Flexible head-light racket for long defensive rallies.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'High Flexibility', 'Head Light', 175, 230, 'Damansara', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Court King', 4.1, 3, FALSE, FALSE, 'active', 1, 11, NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days'),
(78, (SELECT id FROM users WHERE username='court_king'), 'Yonex Duora Z-Strike 5U', 'Stiff head-heavy 5U, rare lighter smash setup.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '5U', 'Stiff Shaft', 'Head Heavy', 640, 800, 'Mont Kiara', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Court King', 4.7, 9, FALSE, FALSE, 'active', 1, 26, NOW() - INTERVAL '17 days', NOW() - INTERVAL '17 days'),
(79, (SELECT id FROM users WHERE username='court_king'), 'Victor Auraspeed 90K II 5U', 'Stiff even-balance speed racket, grommets replaced.', 'Rackets', 'Second-hand (Used)', 'Mailing or Delivery', '5U', 'Stiff Shaft', 'Even Balance', 730, 890, 'Mont Kiara', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Court King', 4.8, 15, FALSE, TRUE, 'active', 1, 52, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
(80, (SELECT id FROM users WHERE username='feather_force'), 'Li-Ning Turbo Charging 75 5U', 'Stiff head-light racket for rapid mid-court blocks.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '5U', 'Stiff Shaft', 'Head Light', 480, 590, 'Ampang', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Feather Force', 4.5, 7, FALSE, FALSE, 'active', 1, 23, NOW() - INTERVAL '24 days', NOW() - INTERVAL '24 days'),
(81, (SELECT id FROM users WHERE username='feather_force'), 'Yonex Nanoflare 001 Ability 5U', 'Medium-flex head-heavy entry attacking racket.', 'Rackets', 'New', 'Mailing or Delivery', '5U', 'Medium Flex', 'Head Heavy', 320, 390, 'Ampang', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Feather Force', 4.6, 11, TRUE, FALSE, 'active', 1, 34, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
(82, (SELECT id FROM users WHERE username='feather_force'), 'Victor Jetspeed S 10 5U', 'Medium-flex even-balance all-round club racket.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '5U', 'Medium Flex', 'Even Balance', 390, 480, 'Setia Alam', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Feather Force', 4.4, 6, FALSE, FALSE, 'active', 1, 20, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
(83, (SELECT id FROM users WHERE username='feather_force'), 'Apacs Vanguard 11 5U', 'Medium-flex head-light defensive doubles racket.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '5U', 'Medium Flex', 'Head Light', 250, 320, 'Setia Alam', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Feather Force', 4.3, 5, FALSE, FALSE, 'active', 1, 17, NOW() - INTERVAL '32 days', NOW() - INTERVAL '32 days'),
(84, (SELECT id FROM users WHERE username='feather_force'), 'Fleet Featherguard 5U', 'Flexible head-heavy racket that adds easy lift power.', 'Rackets', 'Refurbished', 'Meet Up', '5U', 'High Flexibility', 'Head Heavy', 185, 240, 'Cyberjaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Feather Force', 4.1, 2, FALSE, FALSE, 'active', 1, 9, NOW() - INTERVAL '41 days', NOW() - INTERVAL '41 days'),
(85, (SELECT id FROM users WHERE username='net_play'), 'ProKennex Destiny Light 5U', 'Flexible even-balance racket for casual weekly games.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '5U', 'High Flexibility', 'Even Balance', 160, 210, 'Cyberjaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Net Play', 4.2, 4, FALSE, FALSE, 'active', 1, 13, NOW() - INTERVAL '26 days', NOW() - INTERVAL '26 days'),
(86, (SELECT id FROM users WHERE username='net_play'), 'Ashaway Phantom X 5U', 'Flexible head-light racket, easy on the wrist.', 'Rackets', 'New', 'Mailing or Delivery', '5U', 'High Flexibility', 'Head Light', 155, NULL, 'Seremban', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Net Play', 4.5, 8, TRUE, FALSE, 'active', 1, 28, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
(87, (SELECT id FROM users WHERE username='net_play'), 'Apacs Lethal 6 2U', 'Stiff head-heavy 2U for players who want extra smash mass.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '2U', 'Stiff Shaft', 'Head Heavy', 340, 430, 'Seremban', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Net Play', 4.4, 6, FALSE, FALSE, 'active', 1, 21, NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
(88, (SELECT id FROM users WHERE username='net_play'), 'Kawasaki Honour S7 2U', 'Stiff even-balance training frame, very stable on contact.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '2U', 'Stiff Shaft', 'Even Balance', 295, 370, 'Ipoh', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Net Play', 4.3, 5, FALSE, FALSE, 'active', 1, 16, NOW() - INTERVAL '36 days', NOW() - INTERVAL '36 days'),
(89, (SELECT id FROM users WHERE username='net_play'), 'Yonex Muscle Power 29 Light 2U', 'Medium-flex head-heavy power racket for gym-court smash drills.', 'Rackets', 'Second-hand (Used)', 'Mailing or Delivery', '2U', 'Medium Flex', 'Head Heavy', 220, 290, 'Ipoh', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Net Play', 4.2, 3, FALSE, FALSE, 'active', 1, 10, NOW() - INTERVAL '29 days', NOW() - INTERVAL '29 days'),
(90, (SELECT id FROM users WHERE username='smash_lab'), 'Victor Meteor X 2U', 'Medium-flex head-light 2U, unusual but great for drive blocks.', 'Rackets', 'Refurbished', 'Meet Up', '2U', 'Medium Flex', 'Head Light', 205, 270, 'Johor Bahru', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Smash Lab', 4.1, 2, FALSE, FALSE, 'active', 1, 8, NOW() - INTERVAL '44 days', NOW() - INTERVAL '44 days'),
(91, (SELECT id FROM users WHERE username='smash_lab'), 'Felet Tornado 2U', 'Flexible even-balance racket for slower swing tempos.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '2U', 'High Flexibility', 'Even Balance', 180, 240, 'Johor Bahru', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Smash Lab', 4.0, 2, FALSE, FALSE, 'active', 1, 7, NOW() - INTERVAL '38 days', NOW() - INTERVAL '38 days'),
(92, (SELECT id FROM users WHERE username='smash_lab'), 'Carlton Kinesis Xtreme 2U', 'Flexible head-light 2U for players easing into heavier frames.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '2U', 'High Flexibility', 'Head Light', 170, 220, 'Penang', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Smash Lab', 4.1, 3, FALSE, FALSE, 'active', 1, 9, NOW() - INTERVAL '23 days', NOW() - INTERVAL '23 days'),
(93, (SELECT id FROM users WHERE username='smash_lab'), 'Yonex Nanoflare 800 LT 6U', 'Stiff even-balance ultra-light, built for fast doubles.', 'Rackets', 'Second-hand (Used)', 'Mailing or Delivery', '6U', 'Stiff Shaft', 'Even Balance', 710, 860, 'Penang', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Smash Lab', 4.8, 13, FALSE, TRUE, 'active', 1, 48, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
(94, (SELECT id FROM users WHERE username='smash_lab'), 'Li-Ning Windstorm 72C 6U', 'Stiff head-light 6U, almost no swing weight.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '6U', 'Stiff Shaft', 'Head Light', 430, 530, 'Melaka', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Smash Lab', 4.6, 8, FALSE, FALSE, 'active', 1, 25, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
(95, (SELECT id FROM users WHERE username='court_side'), 'Apacs Feather Weight 55 6U', 'Medium-flex head-heavy 6U that still packs a smash.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '6U', 'Medium Flex', 'Head Heavy', 260, 330, 'Melaka', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Court Side', 4.3, 5, FALSE, FALSE, 'active', 1, 16, NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days'),
(96, (SELECT id FROM users WHERE username='court_side'), 'Victor Auraspeed 30H 6U', 'Medium-flex even-balance light racket for all-round play.', 'Rackets', 'New', 'Mailing or Delivery', '6U', 'Medium Flex', 'Even Balance', 345, 420, 'Klang', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Court Side', 4.5, 7, TRUE, FALSE, 'active', 1, 22, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
(97, (SELECT id FROM users WHERE username='court_side'), 'Kawasaki Super Light 6U', 'Flexible head-heavy 6U for beginners who want easy lifts.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '6U', 'High Flexibility', 'Head Heavy', 150, 200, 'Klang', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Court Side', 4.2, 4, FALSE, FALSE, 'active', 1, 12, NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
(98, (SELECT id FROM users WHERE username='court_side'), 'Fleet Nano Pro 6U', 'Flexible head-light 6U, excellent for net kills.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '6U', 'High Flexibility', 'Head Light', 135, 180, 'Mid Valley', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Court Side', 4.1, 3, FALSE, FALSE, 'active', 1, 10, NOW() - INTERVAL '33 days', NOW() - INTERVAL '33 days'),
(99, (SELECT id FROM users WHERE username='court_side'), 'Mizuno Altius Tour 1U', 'Stiff head-heavy training 1U for smash-strength sessions.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '1U', 'Stiff Shaft', 'Head Heavy', 380, 470, 'Mid Valley', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Court Side', 4.4, 6, FALSE, FALSE, 'active', 1, 19, NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
(100, (SELECT id FROM users WHERE username='ace_rackets'), 'Yonex Muscle Power 2 1U', 'Medium-flex head-heavy 1U, used only for warm-up swings.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '1U', 'Medium Flex', 'Head Heavy', 210, 280, 'Sentul', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Ace Rackets', 4.2, 3, FALSE, FALSE, 'active', 1, 11, NOW() - INTERVAL '39 days', NOW() - INTERVAL '39 days'),
(101, (SELECT id FROM users WHERE username='ace_rackets'), 'Victor Training Hammer 1U', 'Medium-flex even-balance 1U for timing drills.', 'Rackets', 'Refurbished', 'Meet Up', '1U', 'Medium Flex', 'Even Balance', 195, 260, 'Sentul', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Ace Rackets', 4.0, 2, FALSE, FALSE, 'active', 1, 8, NOW() - INTERVAL '42 days', NOW() - INTERVAL '42 days'),
(102, (SELECT id FROM users WHERE username='ace_rackets'), 'Apacs Training Blade 1U', 'Flexible head-light 1U so juniors can still swing a heavy frame.', 'Rackets', 'Second-hand (Used)', 'Mailing or Delivery', '1U', 'High Flexibility', 'Head Light', 165, 220, 'Kepong', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Ace Rackets', 4.1, 2, FALSE, FALSE, 'active', 1, 7, NOW() - INTERVAL '37 days', NOW() - INTERVAL '37 days'),
(103, (SELECT id FROM users WHERE username='ace_rackets'), 'Yonex Nanoflare 170 7U', 'Stiff even-balance 7U for lightning-fast doubles defence.', 'Rackets', 'New', 'Mailing or Delivery', '7U', 'Stiff Shaft', 'Even Balance', 410, 490, 'Kepong', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Ace Rackets', 4.6, 9, TRUE, FALSE, 'active', 1, 30, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
(104, (SELECT id FROM users WHERE username='ace_rackets'), 'Li-Ning Windstorm 78+ 7U', 'Medium-flex head-light 7U, almost no forearm fatigue.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '7U', 'Medium Flex', 'Head Light', 275, 350, 'Bangi', 'https://images.unsplash.com/photo-1722003185511-e9320e4a5d00?auto=format&fit=crop&w=800&q=80', 'Ace Rackets', 4.4, 5, FALSE, FALSE, 'active', 1, 14, NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),
(105, (SELECT id FROM users WHERE username='smash_depot'), 'Felet Woven Air 7U', 'Flexible head-heavy 7U that still helps with clears.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '7U', 'High Flexibility', 'Head Heavy', 185, 240, 'Bangi', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'Smash Depot', 4.2, 3, FALSE, FALSE, 'active', 1, 10, NOW() - INTERVAL '27 days', NOW() - INTERVAL '27 days'),
(106, (SELECT id FROM users WHERE username='smash_depot'), 'Fleet Nano Flash 7U', 'Flexible head-light 7U for junior doubles and net play.', 'Rackets', 'New', 'Mailing or Delivery', '7U', 'High Flexibility', 'Head Light', 129, NULL, 'Putrajaya', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'Smash Depot', 4.5, 7, TRUE, FALSE, 'active', 1, 24, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
(107, (SELECT id FROM users WHERE username='smash_depot'), 'Apacs Super Light 8U', 'Medium-flex head-light 8U, the easiest swing in the catalog.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '8U', 'Medium Flex', 'Head Light', 140, 190, 'Putrajaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Smash Depot', 4.3, 4, FALSE, FALSE, 'active', 1, 13, NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
(108, (SELECT id FROM users WHERE username='smash_depot'), 'Kawasaki Super Nano 8U', 'Flexible even-balance 8U for absolute beginners.', 'Rackets', 'New', 'Mailing or Delivery', '8U', 'High Flexibility', 'Even Balance', 119, NULL, 'Serdang', 'https://images.unsplash.com/photo-1722003184145-a68a3b1d845c?auto=format&fit=crop&w=800&q=80', 'Smash Depot', 4.4, 6, TRUE, FALSE, 'active', 1, 18, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
(109, (SELECT id FROM users WHERE username='smash_depot'), 'Felet Air Speed 8U', 'Flexible head-light 8U for kids and recovery sessions.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '8U', 'High Flexibility', 'Head Light', 110, 155, 'Serdang', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Smash Depot', 4.2, 3, FALSE, FALSE, 'active', 1, 9, NOW() - INTERVAL '16 days', NOW() - INTERVAL '16 days')
ON CONFLICT DO NOTHING;

SELECT setval('listings_id_seq', GREATEST((SELECT MAX(id) FROM listings), 1));

-- Orders for ahmad_store (seller 1)
INSERT INTO orders (buyer_id, seller_id, listing_id, quantity, total_price, status, payment_method, created_at, updated_at) VALUES
(2, 1, 20, 1, 450, 'completed', 'cash', NOW() - INTERVAL '80 days', NOW() - INTERVAL '80 days'),
(3, 1, 21, 1, 35,  'completed', 'card', NOW() - INTERVAL '66 days', NOW() - INTERVAL '66 days'),
(4, 1, 22, 1, 120, 'completed', 'cash', NOW() - INTERVAL '50 days', NOW() - INTERVAL '50 days'),
(5, 1, 23, 1, 220, 'completed', 'card', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
(6, 1, 24, 1, 390, 'completed', 'cash', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
(2, 1, 26, 1, 150, 'pending',   'cash', NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days');

-- Orders for howard (8 months of history)
INSERT INTO orders (buyer_id, seller_id, listing_id, quantity, total_price, status, payment_method, created_at, updated_at)
SELECT v.buyer, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), v.listing, 1, v.price, v.status, v.method, NOW() - (v.days || ' days')::interval, NOW() - (v.days || ' days')::interval
FROM (VALUES
  (2, 27, 890, 'completed', 'cash', 105),
  (3, 28, 520, 'completed', 'card', 98),
  (4, 29, 60,  'completed', 'cash', 93),
  (5, 30, 260, 'completed', 'card', 80),
  (6, 31, 95,  'completed', 'cash', 77),
  (7, 32, 610, 'completed', 'card', 65),
  (8, 33, 40,  'completed', 'cash', 59),
  (2, 34, 230, 'completed', 'card', 48),
  (3, 35, 340, 'completed', 'cash', 40),
  (4, 36, 18,  'completed', 'card', 30),
  (5, 38, 28,  'pending',   'cash', 3),
  (6, 40, 175, 'cancelled', 'card', 20),
  (2, 42, 720, 'completed', 'cash', 208),
  (3, 43, 480, 'completed', 'card', 195),
  (4, 44, 180, 'completed', 'cash', 190),
  (5, 45, 90,  'completed', 'card', 178),
  (6, 46, 45,  'completed', 'cash', 162),
  (7, 47, 190, 'completed', 'card', 155),
  (8, 48, 110, 'completed', 'cash', 148),
  (2, 49, 260, 'completed', 'card', 138),
  (3, 50, 140, 'completed', 'cash', 128),
  (4, 51, 550, 'completed', 'card', 118),
  (5, 52, 340, 'completed', 'cash', 21),
  (6, 53, 150, 'completed', 'card', 6),
  (7, 54, 60,  'completed', 'cash', 3),
  (8, 55, 950, 'pending',   'card', 1)
) AS v(buyer, listing, price, status, method, days);

-- Reconcile the seeded listings with the seeded orders above.
--
-- Checkout takes the whole lot: it sets stock_quantity = 0 and moves the
-- listing to 'pending', and confirming delivery then flips it to 'sold'. The
-- inserts above list no stock_quantity, so every seeded listing keeps the
-- column default of 1, and the orders are written straight into their final
-- state -- nothing ever performs that write.
--
-- Left alone, the seller dashboard double-counts. It reports a listing's
-- quantity as remaining stock plus ordered units, so a one-unit listing that
-- earned one unit of revenue shows quantity 2, and price x quantity never
-- tallies with revenue on the My Items table.
--
-- Scoped to the id range seeded above so re-running this file against a live
-- database (make db-migrate) cannot touch listings created through the app --
-- a seller may legitimately re-list a sold item with fresh stock, and there
-- price x quantity is *meant* to differ from historical revenue.
--
-- 'archived' is preserved: archiving is a deliberate seller action, and the
-- dashboard already counts an archived listing with a completed order as sold.
UPDATE listings l
SET stock_quantity = 0,
    status = CASE
        WHEN l.status = 'archived' THEN 'archived'
        WHEN EXISTS (
            SELECT 1 FROM orders o
            WHERE o.listing_id = l.id AND o.status = 'completed'
        ) THEN 'sold'
        ELSE 'pending'
    END
WHERE l.id BETWEEN 20 AND 59
  AND l.stock_quantity <> 0
  AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.listing_id = l.id AND o.status IN ('pending', 'completed')
  );

-- Ceilings on the caller-supplied listing values, matching the Go constants in
-- backend/modules/listing/. The application rejects these first; this is the backstop.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_title_length') THEN
        ALTER TABLE listings ADD CONSTRAINT listings_title_length
        CHECK (char_length(title) <= 70);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_description_length') THEN
        ALTER TABLE listings ADD CONSTRAINT listings_description_length
        CHECK (description IS NULL OR char_length(description) <= 4000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_price_ceiling') THEN
        ALTER TABLE listings ADD CONSTRAINT listings_price_ceiling
        CHECK (price <= 100000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_original_price_ceiling') THEN
        ALTER TABLE listings ADD CONSTRAINT listings_original_price_ceiling
        CHECK (original_price IS NULL OR original_price <= 100000);
    END IF;
    -- Replaces the original >= 0 check, which had no upper bound.
    ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_stock_quantity_nonnegative;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_stock_quantity_range') THEN
        ALTER TABLE listings ADD CONSTRAINT listings_stock_quantity_range
        CHECK (stock_quantity >= 0 AND stock_quantity <= 100);
    END IF;
END $$;

-- API key expiry and richer request logging, for databases created before them.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
UPDATE api_keys SET expires_at = created_at + INTERVAL '30 days' WHERE expires_at IS NULL;
ALTER TABLE api_keys ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE api_keys ALTER COLUMN expires_at
    SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days');

ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(32);
UPDATE api_request_logs SET outcome = 'success' WHERE outcome IS NULL;
ALTER TABLE api_request_logs ALTER COLUMN outcome SET DEFAULT 'success';
ALTER TABLE api_request_logs ALTER COLUMN outcome SET NOT NULL;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255);
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS key_fingerprint VARCHAR(16);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'api_request_logs_outcome_check'
    ) THEN
        ALTER TABLE api_request_logs ADD CONSTRAINT api_request_logs_outcome_check
        CHECK (outcome IN ('success', 'missing_key', 'invalid_key',
                           'revoked_key', 'expired_key', 'rate_limited'));
    END IF;
END $$;

-- Structured address columns, for databases created before they existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS postcode VARCHAR(5);
ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS state VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_listings_state_location
    ON listings(state, location);

-- Seeded listings stored towns in location; map them onto canonical districts.
UPDATE listings l
SET state = m.state, location = m.district
FROM (VALUES
    ('Kuala Lumpur',  'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'),
    ('Bangsar',       'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'),
    ('Mid Valley',    'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'),
    ('Mont Kiara',    'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'),
    ('Kepong',        'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'),
    ('Sentul',        'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'),
    ('Putrajaya',     'Wilayah Persekutuan Putrajaya',    'Putrajaya'),
    ('Petaling Jaya', 'Selangor',        'Petaling'),
    ('Shah Alam',     'Selangor',        'Petaling'),
    ('Subang Jaya',   'Selangor',        'Petaling'),
    ('Puchong',       'Selangor',        'Petaling'),
    ('Damansara',     'Selangor',        'Petaling'),
    ('Serdang',       'Selangor',        'Petaling'),
    ('Setia Alam',    'Selangor',        'Klang'),
    ('Klang',         'Selangor',        'Klang'),
    ('Sentosa',       'Selangor',        'Klang'),
    ('Cheras',        'Selangor',        'Hulu Langat'),
    ('Ampang',        'Selangor',        'Hulu Langat'),
    ('Kajang',        'Selangor',        'Hulu Langat'),
    ('Bangi',         'Selangor',        'Hulu Langat'),
    ('Cyberjaya',     'Selangor',        'Sepang'),
    ('Melaka',        'Melaka',          'Melaka Tengah'),
    ('Seremban',      'Negeri Sembilan', 'Seremban'),
    ('Ipoh',          'Perak',           'Kinta'),
    ('Penang',        'Pulau Pinang',    'Timur Laut'),
    ('Johor Bahru',   'Johor',           'Johor Bahru')
) AS m(town, state, district)
WHERE l.location = m.town;

-- Scatter the demo accounts across all 16 states so the state/district filter
-- has a real spread to test against. Every pair below is a genuine Malaysian
-- district in that state, matching backend/modules/geo/malaysia.go, and the
-- assignment is by id rather than random() so re-running produces the same map.
--
-- Only accounts still carrying a placeholder address are touched, so running
-- this against a live database can never overwrite an address a real user typed.
UPDATE users u
SET phone_no = '+6012' || LPAD(u.id::text, 7, '0'),
    address  = 'No. ' || u.id || ', Jalan Contoh',
    postcode = p.postcode,
    state    = p.state,
    district = p.district
FROM (VALUES
    ( 0, 'Johor',                            'Johor Bahru',              '80000'),
    ( 1, 'Selangor',                         'Petaling',                 '47300'),
    ( 2, 'Pulau Pinang',                     'Timur Laut',               '10000'),
    ( 3, 'Sarawak',                          'Kuching',                  '93000'),
    ( 4, 'Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur',             '50000'),
    ( 5, 'Perak',                            'Kinta',                    '30000'),
    ( 6, 'Sabah',                            'Kota Kinabalu',            '88000'),
    ( 7, 'Selangor',                         'Klang',                    '41000'),
    ( 8, 'Negeri Sembilan',                  'Seremban',                 '70000'),
    ( 9, 'Kedah',                            'Kota Setar',               '05000'),
    (10, 'Pahang',                           'Kuantan',                  '25000'),
    (11, 'Selangor',                         'Hulu Langat',              '43000'),
    (12, 'Melaka',                           'Melaka Tengah',            '75000'),
    (13, 'Kelantan',                         'Kota Bharu',               '15000'),
    (14, 'Terengganu',                       'Kuala Terengganu',         '20000'),
    (15, 'Sarawak',                          'Miri',                     '98000'),
    (16, 'Selangor',                         'Gombak',                   '68100'),
    (17, 'Johor',                            'Batu Pahat',               '83000'),
    (18, 'Pulau Pinang',                     'Seberang Perai Tengah',    '13600'),
    (19, 'Wilayah Persekutuan Putrajaya',    'Putrajaya',                '62000'),
    (20, 'Sabah',                            'Sandakan',                 '90000'),
    (21, 'Perlis',                           'Perlis',                   '01000'),
    (22, 'Selangor',                         'Sepang',                   '43900'),
    (23, 'Perak',                            'Manjung',                  '32040')
) AS p(idx, state, district, postcode)
WHERE p.idx = (u.id % 24)
  AND u.account_status = 'active'
  AND (u.address IS NULL OR u.address = '' OR u.address LIKE 'No. %, Jalan Contoh');

-- Seeded listings take their seller's location, exactly as a new listing does,
-- so the demo data obeys the same rule the app enforces. Scoped to the seeded
-- id range so listings created through the app keep the location they were
-- stamped with at the time.
UPDATE listings l
SET state = u.state, location = u.district
FROM users u
WHERE u.id = l.seller_id
  AND u.state IS NOT NULL AND u.state <> ''
  AND u.district IS NOT NULL AND u.district <> ''
  AND l.id <= 109;
