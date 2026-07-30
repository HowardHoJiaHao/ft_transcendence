package notifications

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

type Repository struct {
	DB *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{DB: db}
}

func truncatePreview(content string, maxRunes int) string {
	content = strings.TrimSpace(content)
	if utf8.RuneCountInString(content) <= maxRunes {
		return content
	}
	runes := []rune(content)
	return strings.TrimSpace(string(runes[:maxRunes])) + "…"
}

func (r *Repository) UpsertMessageTx(tx *sql.Tx, recipientID, actorID, messageID int, content string) (int64, error) {
	data, err := json.Marshal(map[string]interface{}{
		"count":   1,
		"preview": truncatePreview(content, 120),
	})
	if err != nil {
		return 0, err
	}

	var id int64
	err = tx.QueryRow(`
		INSERT INTO notifications (
			user_id, actor_id, notification_type, resource_id, data
		)
		VALUES ($1, $2, 'message', $3, $4::jsonb)
		ON CONFLICT (user_id, actor_id, notification_type)
			WHERE read_at IS NULL AND notification_type = 'message'
		DO UPDATE SET
			resource_id = EXCLUDED.resource_id,
			data = jsonb_build_object(
				'count', COALESCE((notifications.data->>'count')::int, 0) + 1,
				'preview', EXCLUDED.data->>'preview'
			),
			updated_at = CURRENT_TIMESTAMP
		RETURNING id`,
		recipientID, actorID, messageID, data,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("upsert message notification: %w", err)
	}
	return id, nil
}

func (r *Repository) CreateTx(
	tx *sql.Tx,
	recipientID int,
	actorID *int,
	notificationType string,
	resourceID *int,
	data interface{},
) (int64, error) {
	encoded, err := json.Marshal(data)
	if err != nil {
		return 0, fmt.Errorf("encode notification data: %w", err)
	}

	var id int64
	err = tx.QueryRow(`
		INSERT INTO notifications (
			user_id, actor_id, notification_type, resource_id, data
		)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		RETURNING id`,
		recipientID, actorID, notificationType, resourceID, encoded,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("create notification: %w", err)
	}
	return id, nil
}

func scanNotification(scanner interface{ Scan(...interface{}) error }) (Notification, error) {
	var item Notification
	var actorID sql.NullInt64
	var actorUsername sql.NullString
	var actorAvatar sql.NullString
	var resourceID sql.NullInt64
	var readAt sql.NullTime
	var rawData []byte

	err := scanner.Scan(
		&item.ID,
		&item.Type,
		&resourceID,
		&rawData,
		&readAt,
		&item.CreatedAt,
		&item.UpdatedAt,
		&actorID,
		&actorUsername,
		&actorAvatar,
	)
	if err != nil {
		return Notification{}, err
	}
	if len(rawData) == 0 {
		rawData = []byte(`{}`)
	}
	item.Data = json.RawMessage(rawData)
	if resourceID.Valid {
		value := int(resourceID.Int64)
		item.ResourceID = &value
	}
	if readAt.Valid {
		value := readAt.Time
		item.ReadAt = &value
	}
	if actorID.Valid {
		actor := &Actor{ID: int(actorID.Int64), Username: actorUsername.String}
		if actorAvatar.Valid {
			actor.AvatarURL = &actorAvatar.String
		}
		item.Actor = actor
	}
	return item, nil
}

const notificationSelect = `
	SELECT
		n.id,
		n.notification_type,
		n.resource_id,
		n.data,
		n.read_at,
		n.created_at,
		n.updated_at,
		a.id,
		a.username,
		a.avatar_url
	FROM notifications n
	LEFT JOIN users a ON a.id = n.actor_id`

func (r *Repository) GetByID(userID int, notificationID int64) (Notification, error) {
	item, err := scanNotification(r.DB.QueryRow(
		notificationSelect+` WHERE n.user_id = $1 AND n.id = $2`,
		userID, notificationID,
	))
	if err != nil {
		return Notification{}, fmt.Errorf("get notification: %w", err)
	}
	return item, nil
}

func encodeCursor(item Notification) (string, error) {
	raw, err := json.Marshal(cursorPayload{UpdatedAt: item.UpdatedAt, ID: item.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeCursor(value string) (*cursorPayload, error) {
	if value == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor")
	}
	var cursor cursorPayload
	if err := json.Unmarshal(raw, &cursor); err != nil || cursor.ID <= 0 || cursor.UpdatedAt.IsZero() {
		return nil, fmt.Errorf("invalid cursor")
	}
	return &cursor, nil
}

func (r *Repository) List(userID, limit int, before string) (ListResponse, error) {
	cursor, err := decodeCursor(before)
	if err != nil {
		return ListResponse{}, err
	}

	query := notificationSelect + ` WHERE n.user_id = $1`
	args := []interface{}{userID}
	if cursor != nil {
		query += ` AND (n.updated_at, n.id) < ($2, $3)`
		args = append(args, cursor.UpdatedAt, cursor.ID)
	}
	args = append(args, limit+1)
	query += fmt.Sprintf(` ORDER BY n.updated_at DESC, n.id DESC LIMIT $%d`, len(args))

	rows, err := r.DB.Query(query, args...)
	if err != nil {
		return ListResponse{}, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	items := make([]Notification, 0, limit+1)
	for rows.Next() {
		item, scanErr := scanNotification(rows)
		if scanErr != nil {
			return ListResponse{}, fmt.Errorf("scan notification: %w", scanErr)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResponse{}, fmt.Errorf("iterate notifications: %w", err)
	}

	var nextCursor *string
	if len(items) > limit {
		items = items[:limit]
		encoded, err := encodeCursor(items[len(items)-1])
		if err != nil {
			return ListResponse{}, fmt.Errorf("encode cursor: %w", err)
		}
		nextCursor = &encoded
	}

	unread, err := r.UnreadCount(userID)
	if err != nil {
		return ListResponse{}, err
	}
	return ListResponse{Notifications: items, UnreadCount: unread, NextCursor: nextCursor}, nil
}

func (r *Repository) UnreadCount(userID int) (int, error) {
	var count int
	if err := r.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
		userID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count unread notifications: %w", err)
	}
	return count, nil
}

func (r *Repository) MarkRead(userID int, ids []int64) (int, error) {
	placeholders := make([]string, 0, len(ids))
	args := make([]interface{}, 0, len(ids)+1)
	args = append(args, userID)
	for index, id := range ids {
		placeholders = append(placeholders, fmt.Sprintf("$%d", index+2))
		args = append(args, id)
	}
	_, err := r.DB.Exec(`
		UPDATE notifications
		SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
		WHERE user_id = $1 AND id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	if err != nil {
		return 0, fmt.Errorf("mark notifications read: %w", err)
	}
	return r.UnreadCount(userID)
}
