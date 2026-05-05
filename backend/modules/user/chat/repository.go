package chat

import (
	"time"
	"fmt"

	"transcendence/modules/user"
)

type Repository struct {
	*user.Repository
}

func NewRepository(baseRepo *user.Repository) *Repository {
	return &Repository{Repository: baseRepo}
}

func (r *Repository) CreateMessage(senderId, receiverId int, content string) (*Message, error) {
	msg := Message {
		SenderId:   senderId,
		ReceiverId: receiverId,
		Content:    content,
		CreatedAt:  time.Now(),
		IsRead:     false,
	}

	err := r.GormDB.Create(&msg).Error
	if err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	return &msg, nil
}

func (r *Repository) GetMessagesBetween(user1Id, user2Id int) ([]Message, error) {
	var messages []Message

	err := r.GormDB.
		Where("(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
			user1Id, user2Id, user2Id, user1Id).
		Order("created_at ASC").
		Find(&messages).Error

		if err != nil {
			return nil, fmt.Errorf("failed to fetch messages: %w", err)
		}

		return messages, nil
}

//distinct maybe unnecessary
func (r *Repository) GetConversations(userId int) ([]Conversation, error) {
	query := `
		SELECT DISTINCT
			CASE
				WHEN sender_id = $1 THEN receiver_id
				ELSE sender_id
			END as partner_id,
			MAX(created_at) as last_message_at
			FROM messages
			WHERE sender_id = $1 OR receiver_id = $1
			GROUP by partner_id
			ORDER BY last_message_at DESC
	`

	rows, err := r.DB.Query(query, userId)
	if err != nil {
		return nil, fmt.Errorf("failed to query conversations: %w", err)
	}
	defer rows.Close()

	var conversations []Conversation
	for rows.Next() {
		var conv Conversation
		var lastMsgTime time.Time
		err := rows.Scan(&conv.PartnerId, &lastMsgTime)
		if err != nil {
			return nil, err
		}

		partnerUser, err := r.GetUserByID(conv.PartnerId)
		if err != nil {
			return nil, err
		}

		conv.PartnerUsername = partnerUser.Username
		conv.PartnerAvatarUrl = partnerUser.AvatarURL
		conv.LastMessageAt = lastMsgTime
		conversations = append(conversations, conv)
	}
	return conversations, nil
}

func (r *Repository) MarkAsRead(receiverId, senderId int) error {
	_, err := r.DB.Exec(
		"UPDATE messages SET is_read = true WHERE sender_id = $1 AND receiver_id = $2 AND is_read=false",
		senderId, receiverId,
	)
	if err != nil {
		return fmt.Errorf("failed to mark messages as read: %w", err)
	}
	return nil
}

func (r *Repository) GetUnreadCount(userId int) (int, error) {
	var count int
	err := r.DB.QueryRow(
		"SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND is_read = false",
		userId,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count unread messages: %w", err)
	}
	return count, nil
}
