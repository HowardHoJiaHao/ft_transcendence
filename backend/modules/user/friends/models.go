package friends

import (
	"time"
)

type Friendship struct {
	ID      int `gorm:"primaryKey"`
	UserID1 int `gorm:"column:user_id1"`
	UserID2 int `gorm:"column:user_id2"`
}

func (Friendship) TableName() string { return "friendships" }

type Friend struct {
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar,omitempty"`
	IsOnline  bool      `json:"onlineStatus"`
	AddedAt   time.Time `json:"addedAt"`
}
