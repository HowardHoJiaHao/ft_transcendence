package profile

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

func multipartFileHeader(t *testing.T, filename string, data []byte) *multipart.FileHeader {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("avatar", filename)
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	request := httptest.NewRequest("POST", "/upload-avatar", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(3 * 1024 * 1024); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	return request.MultipartForm.File["avatar"][0]
}

func TestSaveAvatarRejectsEmptyAndOversizedFiles(t *testing.T) {
	service := NewService(nil)

	for _, test := range []struct {
		name string
		size int64
	}{
		{name: "empty", size: 0},
		{name: "over two megabytes", size: 2*1024*1024 + 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			file := &multipart.FileHeader{Size: test.size}
			if _, err := service.SaveAvatar(42, file); err == nil {
				t.Fatal("SaveAvatar() accepted an unsafe file size")
			}
		})
	}
}

func TestSaveAvatarRejectsContentThatDoesNotMatchAllowedImageTypes(t *testing.T) {
	service := NewService(nil)
	file := multipartFileHeader(t, "disguised-as-image.png", []byte("this is plain text, not an image"))

	if _, err := service.SaveAvatar(42, file); err == nil {
		t.Fatal("SaveAvatar() trusted the filename instead of checking file content")
	}
}
