package user

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path"
)

func SaveAvatar (userID int, fileHeader *multipart.FileHeader, maxAvatarSize int64) (string, string, error) {
		if fileHeader.Size <= 0 || fileHeader.Size > maxAvatarSize {
		return "", "", fmt.Errorf("avatar must be > 0 and <= 2MB")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return "", "", fmt.Errorf("cannot open uploaded file")
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return "", "", fmt.Errorf("cannot read uploaded file")
	}

	detected := http.DetectContentType(data) // a better way to check data type rather than the extension only. every file type (.img/.jpg/ .exe) has their own binary that unique for the first 50
	mimeToExt := map[string]string{
		"image/jpeg": "jpeg",
		"image/png": "png",
		"image/webp": "webp",
	}
	ext, ok := mimeToExt[detected]
	if !ok{
		return "", "", fmt.Errorf("only jpeg/png/webp allowed")
	}

	storageDir := "static/avatars"
	if err := os.MkdirAll(storageDir, 0755); err != nil { //return nothing if folder already created
		return "", "", fmt.Errorf("failed to create storage dir")
	}

	filename := fmt.Sprintf("avatar=%d.%s", userID, ext)
	fullpath := path.Join(storageDir, filename)

	if err := os.WriteFile(fullpath, data, 0644); err != nil {
		fmt.Printf("write file error\n") //debug
		return "", "", fmt.Errorf("failed to save avatar file")
	}

	publicUrl := fmt.Sprintf("/static/avatars/%s", filename)

	return publicUrl, detected, nil
}
