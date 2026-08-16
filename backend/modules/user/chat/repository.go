package chat

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"transcendence/modules/user"
	"transcendence/modules/user/notifications"
)

type Repository struct {
	*user.Repository
	Notifications *notifications.Repository
}

func NewRepository(baseRepo *user.Repository) *Repository {
	return &Repository{Repository: baseRepo}
}

func (r *Repository) CreateMessage(senderId, receiverId int, content string) (*Message, error) {
	msg := Message{
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

// CreateMessageWithNotification persists the message and its grouped
// notification atomically. Repositories without a notification store retain
// the original behavior, which keeps the module reusable in focused tests.
func (r *Repository) CreateMessageWithNotification(senderID, receiverID int, content string) (*Message, int64, error) {
	if senderID <= 0 || receiverID <= 0 || senderID == receiverID || strings.TrimSpace(content) == "" {
		return nil, 0, fmt.Errorf("invalid private message")
	}
	if r.Notifications == nil {
		message, err := r.CreateMessage(senderID, receiverID, content)
		return message, 0, err
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return nil, 0, fmt.Errorf("start message transaction: %w", err)
	}
	defer tx.Rollback()

	var message Message
	err = tx.QueryRow(`
		INSERT INTO messages (sender_id, receiver_id, content, is_read)
		VALUES ($1, $2, $3, false)
		RETURNING id, sender_id, receiver_id, content, is_read, created_at`,
		senderID, receiverID, content,
	).Scan(
		&message.Id,
		&message.SenderId,
		&message.ReceiverId,
		&message.Content,
		&message.IsRead,
		&message.CreatedAt,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("create message: %w", err)
	}

	notificationID, err := r.Notifications.UpsertMessageTx(
		tx, receiverID, senderID, message.Id, content,
	)
	if err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, fmt.Errorf("commit message transaction: %w", err)
	}
	return &message, notificationID, nil
}

// distinct maybe unnecessary
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
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed reading conversations: %w", err)
	}
	return conversations, nil
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

func (r *Repository) MarkAsRead(receiverId, senderId int) error {
	if r.GormDB == nil {
		return fmt.Errorf("gorm db is not initialized")
	}
	err := r.GormDB.Model(&Message{}).
		Where("sender_id = ? AND receiver_id = ? AND is_read = ?", senderId, receiverId, false).
		Update("is_read", true).Error
	if err != nil {
		return fmt.Errorf("failed to mark messages as read: %w", err)
	}
	return nil
}

func (r *Repository) GetUnreadCount(userId int) (int, error) {
	if r.GormDB == nil {
		return 0, fmt.Errorf("gorm db is not initialized")
	}
	var count int64
	err := r.GormDB.Model(&Message{}).
		Where("receiver_id = ? AND is_read = ?", userId, false).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("failed to count unread messages: %w", err)
	}
	return int(count), nil
}

func (r *Repository) DeleteConversation(userId, partnerId int) error {
	result := r.GormDB.Where(
		"(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)",
		userId, partnerId, partnerId, userId,
	).Delete(&Message{})

	return result.Error
}

// SearchDirectoryUsers returns active accounts other than the requester. Seller
// and buyer filters are derived from marketplace activity rather than a mutable
// profile role, because a member may be both.
func (r *Repository) SearchDirectoryUsers(currentUserID int, search, role string, limit, offset int) ([]DirectoryUser, error) {
	conditions := []string{
		"u.account_status = 'active'",
		"u.id <> $1",
	}
	args := []interface{}{currentUserID}

	search = strings.TrimSpace(search)
	if search != "" {
		args = append(args, "%"+search+"%")
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, "(u.username ILIKE "+placeholder+" OR concat_ws(' ', u.first_name, u.last_name) ILIKE "+placeholder+")")
	}

	switch role {
	case "seller":
		conditions = append(conditions, "EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = u.id AND l.status = 'active')")
	case "buyer":
		conditions = append(conditions, "EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = u.id)")
	}

	args = append(args, limit, offset)
	limitPlaceholder := fmt.Sprintf("$%d", len(args)-1)
	offsetPlaceholder := fmt.Sprintf("$%d", len(args))
	query := `
		SELECT u.id, u.username, u.avatar_url,
			EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = u.id AND l.status = 'active') AS is_seller,
			EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = u.id) AS is_buyer
		FROM users u
		WHERE ` + strings.Join(conditions, " AND ") + `
		ORDER BY lower(u.username), u.id
		LIMIT ` + limitPlaceholder + ` OFFSET ` + offsetPlaceholder

	rows, err := r.DB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("search people directory: %w", err)
	}
	defer rows.Close()

	people := make([]DirectoryUser, 0)
	for rows.Next() {
		var person DirectoryUser
		var avatarURL sql.NullString
		if err := rows.Scan(&person.ID, &person.Username, &avatarURL, &person.IsSeller, &person.IsBuyer); err != nil {
			return nil, fmt.Errorf("scan people directory user: %w", err)
		}
		if avatarURL.Valid {
			person.AvatarURL = &avatarURL.String
		}
		people = append(people, person)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate people directory: %w", err)
	}
	return people, nil
}
