package chat

import (
	"time"
)

type Message struct {
	Id         int       `json:"id" gorm:"primaryKey"`
	SenderId   int       `json:"sender_id" gorm:"not null"`
	ReceiverId int       `json:"receiver_id" gorm:"not null"`
	Content    string    `json:"content" gorm:"type:text; not null"`
	IsRead     bool      `json:"is_read" gorm:"default:false"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime"`
}

type Conversation struct {
	PartnerId        int       `json:"partner_id"`
	PartnerUsername  string    `json:"partner_username"`
	PartnerAvatarUrl *string   `json:"partner_avatar_url,omitempty"`
	LastMessageAt    time.Time `json:"last_message_at"`
}

type InboundMessage struct {
	ReceiverId int    `json:"receiver_id"`
	Content    string `json:"content"`
}

type OutboundMessage struct {
	Type       string `json:"type"`
	SenderId   int    `json:"sender_id"`
	ReceiverId int    `json:"receiver_id"`
	Content    string `json:"content"`
	CreatedAt  string `json:"created_at"`
	Id         int    `json:"id,omitempty"`
}

type OnlineStatusMessage struct {
	Type   string `json:"type"`
	UserId int    `json:"user_id"`
}

type OnlineUsersMessage struct {
	Type    string `json:"type"`
	UserIds []int  `json:"user_ids"`
}
