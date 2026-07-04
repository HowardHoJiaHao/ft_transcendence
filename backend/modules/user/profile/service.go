package profile

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"transcendence/modules/user"
)

type Service struct {
	repo *user.Repository
}

func NewService(repo *user.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) SaveAvatar(userID int, fileHeader *multipart.FileHeader) (string, error) {
	const maxAvatarSize = 2 * 1024 * 1024

	if fileHeader.Size <= 0 || fileHeader.Size > maxAvatarSize {
		return "", fmt.Errorf("avatar must be > 0 and <= 2MB")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return "", fmt.Errorf("cannot open uploaded file")
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("cannot read uploaded file")
	}

	detected := http.DetectContentType(data)
	mimeToExt := map[string]string{
		"image/jpeg": "jpeg",
		"image/png":  "png",
		"image/webp": "webp",
	}
	ext, ok := mimeToExt[detected]
	if !ok {
		return "", fmt.Errorf("only jpeg/png/webp allowed")
	}

	storageDir := "static/avatars"
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create storage dir")
	}

	filename := fmt.Sprintf("avatar=%d.%s", userID, ext)
	fullpath := path.Join(storageDir, filename)

	if err := os.WriteFile(fullpath, data, 0644); err != nil {
		return "", fmt.Errorf("failed to save avatar file")
	}

	publicUrl := fmt.Sprintf("/static/avatars/%s", filename)

	// Update database
	if err := s.repo.UpdateUserAvatarUrl(userID, publicUrl, detected); err != nil {
		return "", fmt.Errorf("failed to update avatar in database")
	}

	return publicUrl, nil
}