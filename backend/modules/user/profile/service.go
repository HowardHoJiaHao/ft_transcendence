package profile

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"transcendence/modules/user"

	"github.com/google/uuid"
)

const avatarsRoot = "storage/avatars"

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

	// One directory per user, mirroring storage/listings/<listingID>/. 0750 not
	// 0755: nothing outside this process ever needs to read it.
	userDir := filepath.Join(avatarsRoot, strconv.Itoa(userID))
	if err := os.MkdirAll(userDir, 0750); err != nil {
		return "", fmt.Errorf("failed to create storage dir")
	}

	// A generated name, not "avatar=<userID>.<ext>". The old scheme was
	// guessable and enumerable — anyone could walk /static/avatars/avatar=1..N
	// and learn which accounts exist and harvest every profile picture. The
	// name is also what defeats browser caching of a replaced avatar, so the
	// frontend no longer needs its cache-busting query string.
	filename := uuid.NewString() + "." + ext
	fullpath := filepath.Join(userDir, filename)

	if err := os.WriteFile(fullpath, data, 0640); err != nil {
		return "", fmt.Errorf("failed to save avatar file")
	}

	// A controlled endpoint, not a static path. Constant per user, so nothing
	// downstream has to be told the filename changed.
	publicUrl := fmt.Sprintf("/api/v1/users/%d/avatar", userID)

	// Remember the previous file so it can be removed once the database points
	// at the new one — dropping it earlier would blank the avatar of anyone
	// mid-request if the update then failed.
	previous, _, prevErr := s.repo.GetUserAvatarFile(userID)

	if err := s.repo.UpdateUserAvatarUrl(userID, publicUrl, filename, detected); err != nil {
		// The row still points at the old file, so remove the orphan we just
		// wrote rather than leaving it behind forever.
		_ = os.Remove(fullpath)
		return "", fmt.Errorf("failed to update avatar in database")
	}

	// Best effort: an avatar is replaced, not accumulated. A failure here only
	// wastes disk, so it must not fail an upload that already succeeded.
	if prevErr == nil && previous != "" && previous != filename {
		_ = os.Remove(filepath.Join(userDir, previous))
	}

	return publicUrl, nil
}
