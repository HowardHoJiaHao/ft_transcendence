package user

import (
	"database/sql"
	"fmt"
	"strings"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateUser(req RegisterRequest) (int64, error) {
	// In production, ALWAYS hash passwords using bcrypt
	avatar := "https://ui-avatars.com/api/?name=" + req.FirstName + "+" + req.LastName
	var id int64
	err := r.db.QueryRow(
		"INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
		req.Username, req.Email, req.Password, req.FirstName, req.LastName, avatar, true,
	).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (r *Repository) GetUserByEmailAndPassword(email, password string) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	var avatarMime sql.NullString
	var avatarData []byte
	err := r.db.QueryRow(
		"SELECT id, username, email, first_name, last_name, avatar_url, avatar_data, avatar_mime_type, bio, created_at FROM users WHERE email = $1 AND password_hash = $2",
		email, password,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &avatarURL, &avatarData, &avatarMime, &bio, &user.CreatedAt)
	
	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
	} else if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	}
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) GetUserByID(id int) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	var avatarMime sql.NullString
	var avatarData []byte
	err := r.db.QueryRow(
		"SELECT id, username, email, first_name, last_name, avatar_url, avatar_data, avatar_mime_type, bio, created_at FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &avatarURL, &avatarData, &avatarMime, &bio, &user.CreatedAt)
	
	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
	} else if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	}
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) UpdateUserProfile(id int, req UpdateProfileRequest) error {
	_, err := r.db.Exec(
		"UPDATE users SET first_name = $1, last_name = $2, bio = $3, avatar_url = $4 WHERE id = $5",
		req.FirstName, req.LastName, req.Bio, req.AvatarURL, id,
	)
	return err
}

func (r *Repository) UpdateUserAvatarBinary(userID int, data []byte, mime string) error {
	_, err := r.db.Exec(
		"UPDATE users SET avatar_data = $1, avatar_mime_type = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
		data, mime, userID,
	)
	return err
}

func (r *Repository) GetUserAvatarBinary(userID int) ([]byte, string, error) {
	var data []byte
	var mime sql.NullString
	err := r.db.QueryRow(
		"SELECT avatar_data, avatar_mime_type FROM users WHERE id = $1 AND avatar_data IS NOT NULL",
		userID,
	).Scan(&data, &mime)
	if err != nil {
		return nil, "", err
	}

	contentType := "application/octet-stream"
	if mime.Valid && strings.TrimSpace(mime.String) != "" {
		contentType = mime.String
	}

	return data, contentType, nil
}

func (r *Repository) GetFriends(userID int) ([]Friend, error) {
	rows, err := r.db.Query(`
		SELECT u.id, u.username, u.avatar_url, f.created_at 
		FROM friendships f
		JOIN users u ON f.friend_id = u.id
		WHERE f.user_id = $1
		ORDER BY f.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var friends []Friend
	for rows.Next() {
		var f Friend
		var avatarURL sql.NullString
		if err := rows.Scan(&f.ID, &f.Username, &avatarURL, &f.AddedAt); err != nil {
			return nil, err
		}
		if avatarURL.Valid {
			f.AvatarURL = &avatarURL.String
		}
		f.IsOnline = true // For simulation
		friends = append(friends, f)
	}
	if friends == nil {
		friends = []Friend{}
	}
	return friends, nil
}

func (r *Repository) AddFriend(userID, friendID int) error {
	// Check if friend exists
	var exists int
	err := r.db.QueryRow("SELECT id FROM users WHERE id = $1", friendID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("friend user does not exist")
	}

	_, err = r.db.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES ($1, $2)", userID, friendID)
	// Bi-directional for simplicity
	_, err = r.db.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES ($1, $2)", friendID, userID)
	return err
}

func (r *Repository) RemoveFriend(userID, friendID int) error {
	_, err := r.db.Exec("DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2", userID, friendID)
	_, err = r.db.Exec("DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2", friendID, userID)
	return err
}
