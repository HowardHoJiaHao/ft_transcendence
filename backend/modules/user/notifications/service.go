package notifications

import (
	"encoding/json"
	"log"
)

type Publisher func(userID int, payload []byte)

type Service struct {
	Repo      *Repository
	Publisher Publisher
}

func NewService(repo *Repository) *Service {
	return &Service{Repo: repo}
}

func (s *Service) PublishByID(userID int, notificationID int64) {
	if s == nil || s.Repo == nil || s.Publisher == nil || notificationID <= 0 {
		return
	}
	item, err := s.Repo.GetByID(userID, notificationID)
	if err != nil {
		log.Printf("notification publish lookup failed: %v", err)
		return
	}
	unread, err := s.Repo.UnreadCount(userID)
	if err != nil {
		log.Printf("notification unread count failed: %v", err)
		return
	}
	payload, err := json.Marshal(WebSocketUpsert{
		Type:         "notification_upsert",
		Notification: item,
		UnreadCount:  unread,
	})
	if err != nil {
		log.Printf("notification publish encoding failed: %v", err)
		return
	}
	s.Publisher(userID, payload)
}
