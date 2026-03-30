-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, --primary key means the official address of row w/ characteristics of unique and cannot be NULL
    username VARCHAR(255) UNIQUE NOT NULL, --not null means columns are mandatory
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    avatar_url VARCHAR(255), --link to the avatar
    bio TEXT, 
    is_verified BOOLEAN DEFAULT FALSE,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    oauth_id VARCHAR(255),
    oauth_provider VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
); 

-- Create products/listings table
CREATE TABLE IF NOT EXISTS listings (
    id SERIAL PRIMARY KEY, 
    seller_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    weight_category VARCHAR(100),
    flexibility_category VARCHAR(100),
	balance_category VARCHAR(100),
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
    image_url VARCHAR(255) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE, --the primary image to be shown first
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
); 

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

-- Create analytics table
CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    user_id INT,
    event_type VARCHAR(50) NOT NULL,
    event_data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
); 

-- Create friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    user_id1 INT NOT NULL,
    user_id2 INT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id1) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id2) REFERENCES users(id) ON DELETE CASCADE
); 

-- Seed sample users
INSERT INTO users (username, email, password_hash, first_name, last_name, is_verified) VALUES
('ahmad_store', 'ahmad@example.com', 'hash1', 'Ahmad', 'Store', TRUE),
('tech_hub', 'tech@example.com', 'hash2', 'Tech', 'Hub', TRUE),
('audio_pro', 'audio@example.com', 'hash3', 'Audio', 'Pro', TRUE),
('home_decor', 'home@example.com', 'hash4', 'Home', 'Decor', TRUE),
('sports_gear', 'sports@example.com', 'hash5', 'Sports', 'Gear', TRUE),
('camera_kingdom', 'camera@example.com', 'hash6', 'Camera', 'Kingdom', TRUE),
('gaming_masters', 'gaming@example.com', 'hash7', 'Gaming', 'Masters', TRUE),
('furniture_palace', 'furniture@example.com', 'hash8', 'Furniture', 'Palace', TRUE),
('muhamadd', 'muhamadd@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Muha', 'Mad', TRUE)
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
