package user

import (
	"database/sql"
	"fmt"
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
	result, err := r.db.Exec(
		"INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		req.Username, req.Email, req.Password, req.FirstName, req.LastName, avatar, true,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (r *Repository) GetUserByEmailAndPassword(email, password string) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	err := r.db.QueryRow(
		"SELECT id, username, email, first_name, last_name, avatar_url, bio, created_at FROM users WHERE email = $1 AND password_hash = $2",
		email, password,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &avatarURL, &bio, &user.CreatedAt)
	
	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	user.AvatarURL = avatarURL.String
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) GetUserByID(id int) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	err := r.db.QueryRow(
		"SELECT id, username, email, first_name, last_name, avatar_url, bio, created_at FROM users WHERE id = ?",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &avatarURL, &bio, &user.CreatedAt)
	
	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	user.AvatarURL = avatarURL.String
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) UpdateUserProfile(id int, req UpdateProfileRequest) error {
	_, err := r.db.Exec(
		"UPDATE users SET first_name = ?, last_name = ?, bio = ?, avatar_url = ? WHERE id = ?",
		req.FirstName, req.LastName, req.Bio, req.AvatarURL, id,
	)
	return err
}

func (r *Repository) GetFriends(userID int) ([]Friend, error) {
	rows, err := r.db.Query(`
		SELECT u.id, u.username, u.avatar_url, f.created_at 
		FROM friendships f
		JOIN users u ON f.friend_id = u.id
		WHERE f.user_id = ?
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
		f.AvatarURL = avatarURL.String
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
	err := r.db.QueryRow("SELECT id FROM users WHERE id = ?", friendID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("friend user does not exist")
	}

	_, err = r.db.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)", userID, friendID)
	// Bi-directional for simplicity
	_, err = r.db.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)", friendID, userID)
	return err
}

func (r *Repository) RemoveFriend(userID, friendID int) error {
	_, err := r.db.Exec("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?", userID, friendID)
	_, err = r.db.Exec("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?", friendID, userID)
	return err
}
