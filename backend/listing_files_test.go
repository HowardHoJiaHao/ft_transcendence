package main

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func listingMultipartHeader(t *testing.T, filename string, data []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", filename)
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("part.Write() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/files", &body)
	request.Header.Set(echo.HeaderContentType, writer.FormDataContentType())
	if err := request.ParseMultipartForm(maxListingFileRequest); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	return request.MultipartForm.File["files"][0]
}

func TestValidateListingFileAcceptsRealImageAndPDFContent(t *testing.T) {
	pngData, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	if err != nil {
		t.Fatalf("DecodeString() error = %v", err)
	}

	tests := []struct {
		name     string
		filename string
		data     []byte
		wantKind string
		wantMIME string
	}{
		{
			name:     "PNG content",
			filename: "racket.png",
			data:     pngData,
			wantKind: "image",
			wantMIME: "image/png",
		},
		{
			name:     "PDF content",
			filename: "receipt.pdf",
			data:     []byte("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
			wantKind: "document",
			wantMIME: "application/pdf",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			file, err := validateListingFile(listingMultipartHeader(t, test.filename, test.data))
			if err != nil {
				t.Fatalf("validateListingFile() error = %v", err)
			}
			if file.kind != test.wantKind || file.mimeType != test.wantMIME {
				t.Fatalf("file = kind %q MIME %q, want %q %q", file.kind, file.mimeType, test.wantKind, test.wantMIME)
			}
		})
	}
}

func TestValidateListingFileRejectsDisguisedAndOversizedContent(t *testing.T) {
	if _, err := validateListingFile(
		listingMultipartHeader(t, "disguised.pdf", []byte("plain text")),
	); err == nil {
		t.Fatal("validateListingFile() accepted text disguised as a PDF")
	}

	oversized := &multipart.FileHeader{
		Filename: "huge.jpg",
		Size:     maxListingImageBytes + 1,
	}
	if _, err := validateListingFile(oversized); err == nil {
		t.Fatal("validateListingFile() accepted an oversized file")
	}
}

func TestDeleteListingFileRejectsNonOwner(t *testing.T) {
	gormDB, mock := newTestGormDB(t)
	mock.ExpectQuery("SELECT l.seller_id, f.storage_name, f.file_kind").
		WithArgs(int64(9), 10).
		WillReturnRows(sqlmock.NewRows(
			[]string{"seller_id", "storage_name", "file_kind", "image"},
		).AddRow(7, "safe.pdf", "document", ""))

	e := echo.New()
	request := httptest.NewRequest(http.MethodDelete, "/products/10/files/9", nil)
	recorder := httptest.NewRecorder()
	context := e.NewContext(request, recorder)
	context.SetPath("/products/:id/files/:fileId")
	context.SetParamNames("id", "fileId")
	context.SetParamValues("10", "9")
	context.Set("userId", 42)

	if err := deleteListingFile(context, gormDB); err != nil {
		t.Fatalf("deleteListingFile() error = %v", err)
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	expectNoOutstandingSQL(t, mock)
}

func TestSafeOriginalNameRemovesPathComponents(t *testing.T) {
	if got := safeOriginalName("../../private/receipt.pdf"); got != "receipt.pdf" {
		t.Fatalf("safeOriginalName() = %q, want receipt.pdf", got)
	}
	if got := safeOriginalName(`..\private\receipt.pdf`); got != "receipt.pdf" {
		t.Fatalf("safeOriginalName() Windows path = %q, want receipt.pdf", got)
	}
}
