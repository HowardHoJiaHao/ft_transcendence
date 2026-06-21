package user

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

type Repository struct {
	DB     *sql.DB
	GormDB *gorm.DB
}

func NewRepository(db *sql.DB, GormDB *gorm.DB) *Repository {
	return &Repository{DB: db, GormDB: GormDB}
}

func (r *Repository) CreateUser(req RegisterRequest) (int64, error) {
	avatar := "https://ui-avatars.com/api/?name=" + req.FirstName + "+" + req.LastName
	var id int64
	err := r.DB.QueryRow(
		"INSERT INTO users (username, email, password_hash, first_name, last_name, phone_no, date_of_birth, gender, avatar_url, is_verified, requires_2fa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id",
		req.Username, req.Email, req.Password, req.FirstName, req.LastName, req.PhoneNo, req.DateOfBirth, req.Gender, avatar, true, true,
	).Scan(&id)
	if err != nil {
		fmt.Printf("\nCreate user error\n")
		return 0, err
	}
	return id, nil
}

func (r *Repository) GetUserByEmailWithPassword(email string) (*User, error) {
	var user User
	var bio, avatarURL, avatarMime sql.NullString /*phone_no, gender*/
	// var dob sql.NullTime
	var avatarData []byte
	err := r.DB.QueryRow(
		"SELECT id, username, email, password_hash, first_name, last_name, avatar_url, phone_no, date_of_birth, gender, avatar_data, avatar_mime_type, bio, requires_2fa, created_at FROM users WHERE email = $1",
		email, 
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.FirstName, &user.LastName, &user.PhoneNo, &user.DateOfBirth, &user.Gender, &avatarURL, &avatarData, &avatarMime, &bio, &user.Requires2FA, &user.CreatedAt)

	if err != nil {
		fmt.Printf("\nFailed to fetch user and password using email\n")
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	} else if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
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
	err := r.DB.QueryRow(
		"SELECT id, username, email, first_name, last_name, phone_no, date_of_birth, gender, avatar_url, avatar_data, avatar_mime_type, bio, requires_2fa, created_at FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &user.PhoneNo, &user.DateOfBirth, &user.Gender, &avatarURL, &avatarData, &avatarMime, &bio, &user.Requires2FA, &user.CreatedAt)

	if err != nil {
		fmt.Printf("Scan error\n")
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	} else if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
	}
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) GetUserByEmail(email string) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	var avatarMime sql.NullString
	var avatarData []byte
	err := r.DB.QueryRow(
		"SELECT id, username, email, first_name, last_name, phone_no, date_of_birth, gender, avatar_url, avatar_data, avatar_mime_type, bio, requires_2fa, created_at FROM users WHERE email = $1",
		email,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &user.PhoneNo, &user.DateOfBirth, &user.Gender, &avatarURL, &avatarData, &avatarMime, &bio, &user.Requires2FA, &user.CreatedAt)

	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	} else if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
	}
	user.IsOnline = true // For demo
	//user.Requires2FA = true // For demo
	return &user, nil
}

//use r.DB.exec when you dont care the information once you execute.use queryrow if you want to know some variables after you exec
//in this case we ignore the sql result
func (r *Repository) UpdateUserProfile(id int, req UpdateProfileRequest) error {
	// _, err := r.DB.Exec(
	// 	"UPDATE users SET first_name = $1, last_name = $2, bio = $3, date_of_birth = $4, gender = $5, avatar_url = $6 WHERE id = $7",
	// 	req.FirstName, req.LastName, req.Bio, req.DateOfBirth, req.Gender, req.AvatarURL, id,
	// )
	// err := r.DB.Model(user).Updates(req).Error
	user, err := r.GetUserByID(id)
	if (err != nil) {
		return fmt.Errorf("Failed to fetch id in UpdateUserProfile")
	}
	return r.GormDB.Model(user).Updates(req).Error
}

func (r *Repository) UpdateUserAvatarUrl(userID int, publicUrl string, mime string) error {
	_, err := r.DB.Exec(
		"UPDATE users SET avatar_url = $1, avatar_mime_type = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
		publicUrl, mime, userID,
	)
	return err
}

//Currently not being used
func (r *Repository) GetUserAvatarBinary(userID int) ([]byte, string, error) {
	var data []byte
	var mime sql.NullString
	err := r.DB.QueryRow(
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

func (r *Repository) SaveOTP(tempToken, email, otpCode string) error {
    if r.GormDB == nil {
        return fmt.Errorf("gorm db is not initialized")
    }
    expiryDate := time.Now().Add(5 * time.Minute)
    otp := OTP{
        Email:     email,
        Code:      otpCode,
        ExpiryDate: expiryDate,
        Used:      false,
        TempToken: tempToken,
    }
    return r.GormDB.Save(&otp).Error
}

func (r *Repository) VerifyOTPAndConsume(tempToken, otpCode string) (string, error) {
    if r.GormDB == nil {
        return "", fmt.Errorf("gorm db is not initialized")
    }
    var otp OTP
    err := r.GormDB.Where(
        "temp_token = ? AND code = ? AND used = ? AND expiry_date > ?",
        tempToken, otpCode, false, time.Now(),
    ).First(&otp).Error
    if err != nil {
        return "", err
    }
    err = r.GormDB.Model(&OTP{}).
        Where("email = ?", otp.Email).
        Updates(map[string]interface{}{"used": true, "temp_token": ""}).Error
    if err != nil {
        return "", err
    }
	return otp.Email, nil
}

func (r *Repository) SaveListingImageBinary(listingID int, data []byte, mime string, isPrimary bool) error {
	_, err := r.DB.Exec(
		`INSERT INTO listing_images (listing_id, image_data, mime_type, is_primary, uploaded_at)
		VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
		listingID, data, mime, isPrimary,
	)
	return err
}

// func (r *Repository) GetFriends(userID int) ([]Friend, error) {
// 	rows, err := r.DB.Query(`
// 		SELECT u.id, u.username, u.avatar_url, f.created_at 
// 		FROM friendships f
// 		JOIN users u ON f.friend_id = u.id
// 		WHERE f.user_id = $1
// 		ORDER BY f.created_at DESC
// 	`, userID)//--JOIN combine two table. ON only combine two rows w/ specific value match
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer rows.Close()

// 	var friends []Friend
// 	for rows.Next() {
// 		var f Friend
// 		var avatarURL sql.NullString
// 		if err := rows.Scan(&f.ID, &f.Username, &avatarURL, &f.AddedAt); err != nil {
// 			return nil, err
// 		}
// 		if avatarURL.Valid {
// 			urlStr := avatarURL.String
// 			f.AvatarURL = &urlStr
// 		}
// 		f.IsOnline = true
// 		friends = append(friends, f)
// 	}
// 	if friends == nil {
// 		friends = []Friend{}
// 	}
// 	return friends, nil
// }

// func (r *Repository) AddFriend(userID, friendID int) error {
// 	//check if friend exists
// 	var exists int
// 	err := r.DB.QueryRow("SELECT id FROM users WHERE id = $1", friendID).Scan(&exists)
// 	if err != nil {
// 		return fmt.Errorf("friend user does not exist")
// 	}

// 	_, err = r.DB.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES ($1, $2)", userID, friendID)
// 	//bidirectional for simplicirt
// 	_, err = r.DB.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES ($1, $2)", friendID, userID)
// 	return err
// }

// func (r *Repository) RemoveFriend(userID, friendID int) error {
// 	_, err := r.DB.Exec("DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2", userID, friendID)
// 	_, err = r.DB.Exec("DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2", friendID, userID)
// 	return err
// }