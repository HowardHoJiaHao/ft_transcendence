package friends

import (
	"time"
)

type Friend struct {
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar,omitempty"`
	IsOnline  bool      `json:"onlineStatus"`
	AddedAt   time.Time `json:"addedAt"`
}
