package friends

import (
	"fmt"

	"transcendence/modules/user"
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
	`, userID)//--JOIN combine two table. ON only combine two rows w/ specific value match
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
	if friends == nil {
		friends = []Friend{}
	}
	return friends, nil
}

func (r *Repository) AddFriend(userId, friendId int) error {
	//check if friend exists
	var exists int
	err := r.DB.QueryRow("SELECT id FROM users WHERE id = $1", friendId).Scan(&exists)
	if err != nil {
		return fmt.Errorf("friend user does not exist")
	}

	query := `
		INSERT INTO friendships (user_id1, user_id2, status)
		VALUES ($1, $2, 'accepted')
		ON CONFLICT (user_id1, user_id2) DO NOTHING`
	
	_, err = r.DB.Exec(query, userId, friendId)
	//bidirectional for simplicity
	_, err = r.DB.Exec(query, friendId, userId)
	return err
}

func (r *Repository) RemoveFriend(userID, friendID int) error {
	_, err := r.DB.Exec("DELETE FROM friendships WHERE user_id1 = $1 AND user_id2 = $2", userID, friendID)
	if err != nil {
		return err
	}
	_, err = r.DB.Exec("DELETE FROM friendships WHERE user_id1 = $1 AND user_id2 = $2", friendID, userID)
	return err
}
