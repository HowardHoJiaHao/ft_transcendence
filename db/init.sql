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
	date_of_birth DATE,
	gender VARCHAR(10) CHECK (gender IN ('Male', 'Female')),
    avatar_url VARCHAR(255), --link to the avatar
    avatar_data BYTEA,
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
    -- CONSTRAINT users_avatar_source_check CHECK (
    --     avatar_data IS NOT NULL
    --     OR (avatar_url IS NOT NULL AND btrim(avatar_url) <> '')
    -- ),
    -- CONSTRAINT users_avatar_mime_check CHECK (
    --     avatar_data IS NULL
    --     OR (avatar_mime_type IS NOT NULL AND btrim(avatar_mime_type) <> '')
    -- )
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
    category VARCHAR(100) DEFAULT 'Others',
    condition VARCHAR(50) DEFAULT 'Second-hand (Used)',
    dealing_method VARCHAR(100) DEFAULT 'Meet Up',
    phone_number VARCHAR(20) DEFAULT '',
    price DECIMAL(10, 2) NOT NULL,
    original_price DECIMAL(10, 2),
    currency VARCHAR(10) DEFAULT 'RM',
    location VARCHAR(100),
    image VARCHAR(255),
    seller_name VARCHAR(255),
    rating DECIMAL(3, 1) DEFAULT 4.5,
    reviews INT DEFAULT 0,
    is_new BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    stock_quantity INT NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'sold', 'archived')),
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

-- Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    reviewer_id INT NOT NULL,
    reviewee_id INT NOT NULL,
    listing_id INT,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewee_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL
);

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
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_key
ON api_request_logs(api_key_id, created_at);

-- Create analytics table
CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    user_id INT,
    event_type VARCHAR(50) NOT NULL,
    event_data JSON,
    listing_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_listing_id ON analytics_events(listing_id);

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
(3, 'Li-Ning Windstorm 72 5U', 'Ultra-light racket made for quick defense and rapid drives.', '5U', 'High Flexibility', 'Head Light', 430, 520, 'Shah Alam', 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop', 'Audio Pro', 4.7, 234, FALSE, FALSE, 'active'),
(4, 'Apacs Z-Ziggler 2U', 'Solid frame for players who prefer extra mass and stability on smashes.', '2U', 'Stiff Shaft', 'Head Heavy', 350, NULL, 'Bangsar', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop', 'Home Decor Store', 4.6, 45, FALSE, FALSE, 'active'),
(5, 'Mizuno Altius 1U Training Racket', 'Heavy training racket to build swing strength and timing consistency.', '1U', 'Medium Flex', 'Head Heavy', 290, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'Sports Gear', 4.5, 67, TRUE, FALSE, 'active'),
(6, 'Felet Woven 888 6U', 'Lightweight option for doubles defense and quick front-court exchanges.', '6U', 'High Flexibility', 'Head Light', 260, 320, 'Sentosa', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Camera Kingdom', 4.9, 178, FALSE, TRUE, 'active'),
(7, 'Kawasaki Hyper Nano 7U', 'Very light frame built for speed, great for beginner and junior players.', '7U', 'Medium Flex', 'Even Balance', 220, NULL, 'Cyberjaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Gaming Masters', 4.8, 124, TRUE, TRUE, 'active'),
(8, 'Fleet Nano Power 8U', 'Extremely agile racket for rapid net play and easy maneuverability.', '8U', 'High Flexibility', 'Head Light', 180, NULL, 'Mid Valley', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Furniture Palace', 4.4, 56, FALSE, FALSE, 'active'),
(9, 'Racket Pro Attack', 'Can smash with steep angle and strong follow-through. Ideal for attacking style.', '3U', 'Stiff Shaft', 'Head Heavy', 150, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Sport Master', 4.4, 56, TRUE, TRUE, 'active')
ON CONFLICT DO NOTHING;

-- Seed basic dummy data for analytics
INSERT INTO analytics_events (user_id, event_type, event_data) VALUES
(1, 'user_signup', '{"method":"email"}'),
(2, 'user_login', '{"success":true}'),
(3, 'password_change', '{"strength":"strong"}'),
(4, 'listing_created', '{"title":"iPhone 14 Pro - Excellent Condition"}'),
(5, 'listing_viewed', '{"title":"MacBook Air M1 2020"}'),
(6, 'order_placed', '{"listing_id":1,"quantity":1}'),
(7, 'order_status_updated', '{"order_id":1,"status":"shipped"}'),
(8, 'review_submitted', '{"listing_id":1,"rating":5}')
ON CONFLICT DO NOTHING;

-- Create analytics table
CREATE TABLE IF NOT EXISTS analytics (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    listing_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id)
);

-- Enable pgvector extension and create faq_embeddings table
CREATE EXTENSION IF NOT EXISTS vector;

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
(21, 1, 'Yonex Mavis 350 Shuttlecocks (Tube of 6)', 'Unopened tube, nylon shuttlecocks.', 'Accessories', 'New', 'Delivery', '', '', '', 35, NULL, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop', 'Ahmad Store', 4.9, 8, TRUE, FALSE, 'sold', 21, NOW() - INTERVAL '70 days', NOW() - INTERVAL '66 days'),
(22, 1, 'Badminton Kit Bag - 6 Racket Capacity', 'Padded compartments, barely used.', 'Bags', 'Second-hand (Used)', 'Meet Up', '', '', '', 120, 160, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'Ahmad Store', 4.6, 5, FALSE, FALSE, 'sold', 18, NOW() - INTERVAL '55 days', NOW() - INTERVAL '50 days'),
(23, 1, 'Yonex Court Shoes SHB 65Z3 (US9)', 'Worn twice, like new condition.', 'Footwear', 'Second-hand (Used)', 'Meet Up', '', '', '', 220, 320, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'Ahmad Store', 4.8, 9, FALSE, TRUE, 'sold', 40, NOW() - INTERVAL '38 days', NOW() - INTERVAL '30 days'),
(24, 1, 'Li-Ning Turbo X1 4U', 'Control-oriented racket, great for doubles.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Medium Flex', 'Even Balance', 390, NULL, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'Ahmad Store', 4.5, 3, FALSE, FALSE, 'sold', 15, NOW() - INTERVAL '20 days', NOW() - INTERVAL '15 days'),
(25, 1, 'Grip Tape Bundle (5 pcs)', 'Assorted overgrips, mixed colors.', 'Accessories', 'New', 'Delivery', '', '', '', 25, NULL, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'Ahmad Store', 4.4, 2, TRUE, FALSE, 'active', 9, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
(26, 1, 'Apacs Feather Weight X Speed', 'Ultra-light frame, needs restring.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '6U', 'High Flexibility', 'Head Light', 150, 210, 'Kuala Lumpur', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop', 'Ahmad Store', 4.3, 1, FALSE, FALSE, 'active', 62, NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- Listings for howard, ids 27-59
INSERT INTO listings (id, seller_id, title, description, category, condition, dealing_method, weight_category, flexibility_category, balance_category, price, original_price, location, image, seller_name, rating, reviews, is_new, is_featured, status, views_count, created_at, updated_at) VALUES
(27, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Nanoflare 800 Pro 4U', 'Speed-oriented racket, excellent condition.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Head Light', 890, 1050, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.8, 15, FALSE, TRUE, 'sold', 58, NOW() - INTERVAL '120 days', NOW() - INTERVAL '105 days'),
(28, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Thruster Ryuga II', 'Head-heavy power racket, minor scratches.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 520, 650, 'Subang Jaya', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'howard', 4.6, 9, FALSE, FALSE, 'sold', 41, NOW() - INTERVAL '110 days', NOW() - INTERVAL '98 days'),
(29, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'RSL Shuttlecocks (Tube of 12)', 'Feather shuttlecocks, tournament grade.', 'Accessories', 'New', 'Delivery', '', '', '', 60, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop', 'howard', 4.9, 22, TRUE, FALSE, 'sold', 33, NOW() - INTERVAL '100 days', NOW() - INTERVAL '93 days'),
(30, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Adidas Court Stabil Shoes (US10)', 'Worn a handful of times, great grip.', 'Footwear', 'Second-hand (Used)', 'Meet Up', '', '', '', 260, 380, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.7, 11, FALSE, TRUE, 'sold', 47, NOW() - INTERVAL '90 days', NOW() - INTERVAL '80 days'),
(31, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Racket Bag (3-in-1)', 'Holds 3 rackets, side pocket for shoes.', 'Bags', 'Second-hand (Used)', 'Meet Up', '', '', '', 95, 140, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.5, 6, FALSE, FALSE, 'sold', 29, NOW() - INTERVAL '85 days', NOW() - INTERVAL '77 days'),
(32, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Li-Ning Aeronaut 7000 Combat', 'Tournament racket, comes with new grip.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 610, 720, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.8, 13, FALSE, FALSE, 'sold', 52, NOW() - INTERVAL '75 days', NOW() - INTERVAL '65 days'),
(33, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Overgrip Bundle (10 pcs, assorted)', 'Mixed brands, unused.', 'Accessories', 'New', 'Delivery', '', '', '', 40, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'howard', 4.4, 4, TRUE, FALSE, 'sold', 19, NOW() - INTERVAL '65 days', NOW() - INTERVAL '59 days'),
(34, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Power Cushion 65 Z2 (US9)', 'Lightweight court shoes, good tread left.', 'Footwear', 'Second-hand (Used)', 'Meet Up', '', '', '', 230, 300, 'Subang Jaya', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop', 'howard', 4.6, 8, FALSE, FALSE, 'sold', 36, NOW() - INTERVAL '55 days', NOW() - INTERVAL '48 days'),
(35, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Apacs Ziggler Speed 2U', 'Control frame, restrung last month.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '2U', 'Stiff Shaft', 'Head Heavy', 340, 420, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.5, 5, FALSE, FALSE, 'sold', 28, NOW() - INTERVAL '48 days', NOW() - INTERVAL '40 days'),
(36, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Wristband Set (4 pairs)', 'Sweat-absorbent, unused.', 'Accessories', 'New', 'Delivery', '', '', '', 18, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.3, 2, TRUE, FALSE, 'sold', 14, NOW() - INTERVAL '35 days', NOW() - INTERVAL '30 days'),
(37, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Astrox 88D Pro 3U', 'Doubles-focused racket, like new.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 780, 920, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.9, 17, FALSE, TRUE, 'active', 66, NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
(38, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor A960 Shuttlecocks (Tube of 6)', 'Nylon, durable for daily practice.', 'Accessories', 'New', 'Delivery', '', '', '', 28, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop', 'howard', 4.4, 3, TRUE, FALSE, 'active', 22, NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
(39, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Mizuno Wave Fang Pro 2 (US9.5)', 'Premium court shoes, excellent cushioning.', 'Footwear', 'Second-hand (Used)', 'Meet Up', '', '', '', 310, 400, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'howard', 4.7, 7, FALSE, FALSE, 'active', 31, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
(40, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Felet TR Woven 7U', 'Ultra-light doubles racket, needs grip change.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '7U', 'High Flexibility', 'Head Light', 175, 240, 'Subang Jaya', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'howard', 4.2, 1, FALSE, FALSE, 'active', 44, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days'),
(41, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Sports Towel + Cap Combo', 'Quick-dry towel with matching cap.', 'Accessories', 'New', 'Delivery', '', '', '', 22, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop', 'howard', 4.1, 1, TRUE, FALSE, 'archived', 6, NOW() - INTERVAL '150 days', NOW() - INTERVAL '140 days'),
(42, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Arcsaber 11 Pro 3U', 'All-round classic, well maintained.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 720, 850, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.8, 14, FALSE, FALSE, 'sold', 45, NOW() - INTERVAL '220 days', NOW() - INTERVAL '208 days'),
(43, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Brave Sword 12 SE', 'Legendary speed frame, grommets replaced.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Light', 480, 580, 'Subang Jaya', 'https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=400&h=300&fit=crop', 'howard', 4.7, 10, FALSE, FALSE, 'sold', 38, NOW() - INTERVAL '210 days', NOW() - INTERVAL '195 days'),
(44, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'BG80 String Reel (200m)', 'Half-used reel, kept dry.', 'Strings', 'Second-hand (Used)', 'Meet Up', '', '', '', 180, 260, 'Subang Jaya', 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop', 'howard', 4.6, 6, FALSE, FALSE, 'sold', 20, NOW() - INTERVAL '200 days', NOW() - INTERVAL '190 days'),
(45, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Team Jacket (L)', 'Tournament jacket, worn once.', 'Apparel', 'Second-hand (Used)', 'Delivery', '', '', '', 90, 150, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.5, 4, FALSE, FALSE, 'sold', 16, NOW() - INTERVAL '190 days', NOW() - INTERVAL '178 days'),
(46, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Li-Ning Court Shorts (M) x2', 'Two pairs, excellent condition.', 'Apparel', 'Second-hand (Used)', 'Delivery', '', '', '', 45, 80, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.4, 3, FALSE, FALSE, 'sold', 12, NOW() - INTERVAL '175 days', NOW() - INTERVAL '162 days'),
(47, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor P9200 Shoes (US8.5)', 'Cushioned sole, good for wide feet.', 'Footwear', 'Second-hand (Used)', 'Meet Up', '', '', '', 190, 280, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'howard', 4.6, 7, FALSE, FALSE, 'sold', 27, NOW() - INTERVAL '170 days', NOW() - INTERVAL '155 days'),
(48, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Aerobite Hybrid String Set x5', 'Five packs, sealed.', 'Strings', 'New', 'Delivery', '', '', '', 110, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=400&h=300&fit=crop', 'howard', 4.7, 5, TRUE, FALSE, 'sold', 23, NOW() - INTERVAL '160 days', NOW() - INTERVAL '148 days'),
(49, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Astrox 77 Play 4U', 'Entry attacking racket, near new.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Medium Flex', 'Head Heavy', 260, 330, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.5, 4, FALSE, FALSE, 'sold', 31, NOW() - INTERVAL '150 days', NOW() - INTERVAL '138 days'),
(50, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Net + Posts (Portable)', 'Full set for driveway games.', 'Accessories', 'Second-hand (Used)', 'Meet Up', '', '', '', 140, 220, 'Subang Jaya', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop', 'howard', 4.3, 2, FALSE, FALSE, 'sold', 17, NOW() - INTERVAL '140 days', NOW() - INTERVAL '128 days'),
(51, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Thruster F Enhanced', 'Singles powerhouse, fresh grip.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Stiff Shaft', 'Head Heavy', 550, 680, 'Subang Jaya', 'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=400&h=300&fit=crop', 'howard', 4.8, 11, FALSE, TRUE, 'sold', 49, NOW() - INTERVAL '130 days', NOW() - INTERVAL '118 days'),
(52, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Comfort Z3 Shoes (US10)', 'Top-tier shoes, light wear.', 'Footwear', 'Second-hand (Used)', 'Meet Up', '', '', '', 340, 480, 'Subang Jaya', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&h=300&fit=crop', 'howard', 4.9, 13, FALSE, TRUE, 'sold', 44, NOW() - INTERVAL '28 days', NOW() - INTERVAL '21 days'),
(53, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Exbolt 63 String Packs x8', 'Sealed, popular gauge.', 'Strings', 'New', 'Delivery', '', '', '', 150, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1613918431703-aa508db4f50f?w=400&h=300&fit=crop', 'howard', 4.6, 6, TRUE, FALSE, 'sold', 26, NOW() - INTERVAL '14 days', NOW() - INTERVAL '6 days'),
(54, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Li-Ning Tournament Shirt (M) x3', 'Three shirts, barely worn.', 'Apparel', 'Second-hand (Used)', 'Delivery', '', '', '', 60, 105, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.4, 3, FALSE, FALSE, 'sold', 19, NOW() - INTERVAL '9 days', NOW() - INTERVAL '3 days'),
(55, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Yonex Astrox 100ZZ 4U', 'Flagship attacking racket, kept mint.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '4U', 'Stiff Shaft', 'Head Heavy', 950, 1150, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.9, 20, FALSE, TRUE, 'active', 12, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
(56, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Badminton Stringing Machine (Manual)', 'Hobbyist crank machine, works great.', 'Accessories', 'Second-hand (Used)', 'Meet Up', '', '', '', 850, 1300, 'Subang Jaya', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ad?w=400&h=300&fit=crop', 'howard', 4.5, 4, FALSE, FALSE, 'active', 8, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
(57, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Victor Crown Collection Cap', 'Limited edition, tags on.', 'Apparel', 'New', 'Delivery', '', '', '', 55, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=300&fit=crop', 'howard', 4.2, 1, TRUE, FALSE, 'active', 5, NOW() - INTERVAL '50 days', NOW() - INTERVAL '50 days'),
(58, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Old Club Jersey Set (5 pcs)', 'Retired club jerseys, collector item.', 'Apparel', 'Second-hand (Used)', 'Meet Up', '', '', '', 75, 120, 'Subang Jaya', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400&h=300&fit=crop', 'howard', 4.0, 1, FALSE, FALSE, 'archived', 11, NOW() - INTERVAL '130 days', NOW() - INTERVAL '95 days'),
(59, (SELECT id FROM users WHERE email='howardho992002@gmail.com'), 'Kason Vintage Racket (Display)', 'Wall display piece, not for play.', 'Rackets', 'Second-hand (Used)', 'Meet Up', '3U', 'Medium Flex', 'Even Balance', 200, NULL, 'Subang Jaya', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=400&h=300&fit=crop', 'howard', 4.1, 2, FALSE, FALSE, 'archived', 7, NOW() - INTERVAL '115 days', NOW() - INTERVAL '88 days')
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

-- Recent listing views for seller dashboard demo data
INSERT INTO analytics_events (user_id, event_type, listing_id, created_at)
SELECT viewer, 'listing_viewed', listing_id, NOW() - (days * INTERVAL '1 day')
FROM (VALUES
    (2, 20, 5),
    (3, 21, 4),
    (4, 22, 3),
    (5, 23, 2),
    (6, 24, 8),
    (7, 25, 1),
    (8, 26, 12),
    (2, 27, 6),
    (3, 28, 9),
    (4, 29, 10),
    (5, 30, 11),
    (6, 31, 7),
    (7, 32, 14),
    (8, 33, 15)
) AS v(viewer, listing_id, days);
