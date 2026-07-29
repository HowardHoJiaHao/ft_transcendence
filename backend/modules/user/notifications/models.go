package notifications

import (
	"encoding/json"
	"time"
)

const (
	TypeMessage        = "message"
	TypeFriendAdded    = "friend_added"
	TypeOrderNew       = "order_new"
	TypeOrderCompleted = "order_completed"
)

type Actor struct {
	ID        int     `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
}

type Notification struct {
	ID         int64           `json:"id"`
	Type       string          `json:"type"`
	Actor      *Actor          `json:"actor,omitempty"`
	ResourceID *int            `json:"resourceId,omitempty"`
	Data       json.RawMessage `json:"data"`
	ReadAt     *time.Time      `json:"readAt,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

type ListResponse struct {
	Notifications []Notification `json:"notifications"`
	UnreadCount   int            `json:"unreadCount"`
	NextCursor    *string        `json:"nextCursor"`
}

type ReadRequest struct {
	IDs []int64 `json:"ids"`
}

type ReadResponse struct {
	UnreadCount int `json:"unreadCount"`
}

type WebSocketUpsert struct {
	Type         string       `json:"type"`
	Notification Notification `json:"notification"`
	UnreadCount  int          `json:"unread_count"`
}

type cursorPayload struct {
	UpdatedAt time.Time `json:"updatedAt"`
	ID        int64     `json:"id"`
}
