package friends

import (
	"database/sql"
	"fmt"

	"transcendence/modules/user"
	"transcendence/modules/user/notifications"
)

type Repository struct {
	*user.Repository
}

func NewRepository(baseRepo *user.Repository) *Repository {
	return &Repository{Repository: baseRepo}
}

func (r *Repository) GetFriends(userID int) ([]Friend, error) {
	rows, err := r.DB.Query(`
		SELECT u.id, u.username, u.avatar_url, f.created_at 
		FROM friendships f
		JOIN users u ON f.user_id2 = u.id
		WHERE f.user_id1 = $1 AND f.status = 'accepted'
		ORDER BY f.created_at DESC
	`, userID) //--JOIN combine two table. ON only combine two rows w/ specific value match
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var friends []Friend
	for rows.Next() {
		var f Friend
		if err := rows.Scan(&f.ID, &f.Username, &f.AvatarURL, &f.AddedAt); err != nil {
			return nil, err
		}
		friends = append(friends, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if friends == nil {
		friends = []Friend{}
	}
	return friends, nil
}

func (r *Repository) AddFriend(userId, friendId int) error {
	_, err := r.AddFriendWithNotification(userId, friendId, nil)
	return err
}

// AddFriendWithNotification creates both accepted friendship rows in one
// transaction and creates a recipient notification only for a genuinely new
// friendship.
func (r *Repository) AddFriendWithNotification(
	userID, friendID int,
	notificationRepo *notifications.Repository,
) (int64, error) {
	if userID == friendID {
		return 0, fmt.Errorf("cannot add yourself as a friend")
	}

	//check if friend exists
	var exists int
	err := r.DB.QueryRow(
		"SELECT id FROM users WHERE id = $1 AND account_status = 'active'",
		friendID,
	).Scan(&exists)
	if err != nil {
		return 0, fmt.Errorf("friend user does not exist")
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("start friendship transaction: %w", err)
	}
	defer tx.Rollback()

	query := `
		INSERT INTO friendships (user_id1, user_id2, status)
		VALUES ($1, $2, 'accepted')
		ON CONFLICT (user_id1, user_id2) DO NOTHING
		RETURNING id`

	var firstID int
	firstCreated := true
	if err := tx.QueryRow(query, userID, friendID).Scan(&firstID); err != nil {
		if err != sql.ErrNoRows {
			return 0, fmt.Errorf("create friendship: %w", err)
		}
		firstCreated = false
	}

	var reverseID int
	if err := tx.QueryRow(query, friendID, userID).Scan(&reverseID); err != nil && err != sql.ErrNoRows {
		return 0, fmt.Errorf("create reciprocal friendship: %w", err)
	}

	var notificationID int64
	if firstCreated && notificationRepo != nil {
		actorID := userID
		resourceID := userID
		notificationID, err = notificationRepo.CreateTx(
			tx,
			friendID,
			&actorID,
			notifications.TypeFriendAdded,
			&resourceID,
			map[string]interface{}{"profileUserId": userID},
		)
		if err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit friendship transaction: %w", err)
	}
	return notificationID, nil
}

func (r *Repository) RemoveFriend(userID, friendID int) error {
	_, err := r.DB.Exec("DELETE FROM friendships WHERE user_id1 = $1 AND user_id2 = $2", userID, friendID)
	if err != nil {
		return err
	}
	_, err = r.DB.Exec("DELETE FROM friendships WHERE user_id1 = $1 AND user_id2 = $2", friendID, userID)
	return err
}
