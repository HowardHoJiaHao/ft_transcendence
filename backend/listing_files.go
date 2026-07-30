package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const (
	listingFilesRoot       = "storage/listings"
	maxListingFileRequest  = 72 * 1024 * 1024
	maxListingImageBytes   = 10 * 1024 * 1024
	maxListingDocumentSize = 5 * 1024 * 1024
	maxListingImages       = 6
	maxListingDocuments    = 2
)

type listingFileResponse struct {
	ID           int64     `json:"id"`
	ListingID    int       `json:"listingId"`
	OriginalName string    `json:"originalName"`
	Kind         string    `json:"kind"`
	MimeType     string    `json:"mimeType"`
	Size         int64     `json:"size"`
	DisplayOrder int       `json:"displayOrder"`
	ContentURL   string    `json:"contentUrl"`
	CreatedAt    time.Time `json:"createdAt"`
}

type validatedListingFile struct {
	originalName string
	kind         string
	mimeType     string
	extension    string
	data         []byte
}

func listingFileURL(id int64) string {
	return fmt.Sprintf("/api/v1/files/%d/content", id)
}

func scanListingFileRow(scanner interface{ Scan(...any) error }) (listingFileResponse, error) {
	var file listingFileResponse
	err := scanner.Scan(
		&file.ID,
		&file.ListingID,
		&file.OriginalName,
		&file.Kind,
		&file.MimeType,
		&file.Size,
		&file.DisplayOrder,
		&file.CreatedAt,
	)
	file.ContentURL = listingFileURL(file.ID)
	return file, err
}

func listListingFiles(c echo.Context, gormDB *gorm.DB) error {
	listingID, err := strconv.Atoi(c.Param("id"))
	if err != nil || listingID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid listing id"})
	}
	db, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}

	var exists bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM listings WHERE id = $1)", listingID).Scan(&exists); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database error"})
	}
	if !exists {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "listing not found"})
	}

	rows, err := db.Query(`
		SELECT id, listing_id, original_name, file_kind, mime_type, size_bytes,
		       display_order, created_at
		FROM listing_files
		WHERE listing_id = $1
		ORDER BY CASE file_kind WHEN 'image' THEN 0 ELSE 1 END, display_order, id`,
		listingID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list files"})
	}
	defer rows.Close()

	files := make([]listingFileResponse, 0)
	for rows.Next() {
		file, scanErr := scanListingFileRow(rows)
		if scanErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read file metadata"})
		}
		files = append(files, file)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list files"})
	}
	return c.JSON(http.StatusOK, map[string]any{"files": files})
}

func uploadListingFiles(c echo.Context, gormDB *gorm.DB) error {
	listingID, err := strconv.Atoi(c.Param("id"))
	if err != nil || listingID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid listing id"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid authorization token"})
	}
	db, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}

	var sellerID int
	var currentPrimary string
	if err := db.QueryRow(
		"SELECT seller_id, COALESCE(image, '') FROM listings WHERE id = $1",
		listingID,
	).Scan(&sellerID, &currentPrimary); err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "listing not found"})
	} else if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database error"})
	}
	if sellerID != userID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "forbidden"})
	}

	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxListingFileRequest)
	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid or oversized multipart form"})
	}
	defer form.RemoveAll()
	headers := form.File["files"]
	if len(headers) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no files provided"})
	}

	var existingImages, existingDocuments int
	if err := db.QueryRow(`
		SELECT COUNT(*) FILTER (WHERE file_kind = 'image'),
		       COUNT(*) FILTER (WHERE file_kind = 'document')
		FROM listing_files WHERE listing_id = $1`,
		listingID,
	).Scan(&existingImages, &existingDocuments); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to count existing files"})
	}

	validated := make([]validatedListingFile, 0, len(headers))
	newImages, newDocuments := 0, 0
	for _, header := range headers {
		file, validationErr := validateListingFile(header)
		if validationErr != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("%s: %v", safeOriginalName(header.Filename), validationErr),
			})
		}
		if file.kind == "image" {
			newImages++
		} else {
			newDocuments++
		}
		validated = append(validated, file)
	}
	if existingImages+newImages > maxListingImages {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "a listing can have at most 6 images"})
	}
	if existingDocuments+newDocuments > maxListingDocuments {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "a listing can have at most 2 PDF documents"})
	}

	listingDir := filepath.Join(listingFilesRoot, strconv.Itoa(listingID))
	if err := os.MkdirAll(listingDir, 0750); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create secure storage directory"})
	}

	type storedUpload struct {
		validatedListingFile
		storageName string
		fullPath    string
	}
	stored := make([]storedUpload, 0, len(validated))
	cleanup := func() {
		for _, file := range stored {
			_ = os.Remove(file.fullPath)
		}
	}
	for _, file := range validated {
		storageName := uuid.NewString() + file.extension
		fullPath := filepath.Join(listingDir, storageName)
		if err := os.WriteFile(fullPath, file.data, 0640); err != nil {
			cleanup()
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to store uploaded files"})
		}
		stored = append(stored, storedUpload{
			validatedListingFile: file,
			storageName:          storageName,
			fullPath:             fullPath,
		})
	}

	tx, err := db.Begin()
	if err != nil {
		cleanup()
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save file metadata"})
	}
	defer tx.Rollback()

	result := make([]listingFileResponse, 0, len(stored))
	nextImageOrder, nextDocumentOrder := existingImages, existingDocuments
	var firstImageURL string
	for _, storedFile := range stored {
		displayOrder := nextDocumentOrder
		if storedFile.kind == "image" {
			displayOrder = nextImageOrder
			nextImageOrder++
		} else {
			nextDocumentOrder++
		}

		row := tx.QueryRow(`
			INSERT INTO listing_files
			    (listing_id, original_name, storage_name, file_kind, mime_type, size_bytes, display_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, listing_id, original_name, file_kind, mime_type, size_bytes,
			          display_order, created_at`,
			listingID,
			storedFile.originalName,
			storedFile.storageName,
			storedFile.kind,
			storedFile.mimeType,
			len(storedFile.data),
			displayOrder,
		)
		saved, scanErr := scanListingFileRow(row)
		if scanErr != nil {
			cleanup()
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save file metadata"})
		}
		if firstImageURL == "" && saved.Kind == "image" {
			firstImageURL = saved.ContentURL
		}
		result = append(result, saved)
	}
	if currentPrimary == "" && firstImageURL != "" {
		if _, err := tx.Exec(
			"UPDATE listings SET image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
			firstImageURL,
			listingID,
		); err != nil {
			cleanup()
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update listing cover image"})
		}
	}
	if err := tx.Commit(); err != nil {
		cleanup()
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit uploaded files"})
	}

	return c.JSON(http.StatusCreated, map[string]any{"files": result})
}

func validateListingFile(header *multipart.FileHeader) (validatedListingFile, error) {
	name := safeOriginalName(header.Filename)
	if header.Size <= 0 {
		return validatedListingFile{}, fmt.Errorf("file is empty")
	}
	if header.Size > maxListingImageBytes {
		return validatedListingFile{}, fmt.Errorf("file exceeds the 10MB maximum")
	}
	file, err := header.Open()
	if err != nil {
		return validatedListingFile{}, fmt.Errorf("cannot open file")
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxListingImageBytes+1))
	if err != nil {
		return validatedListingFile{}, fmt.Errorf("cannot read file")
	}
	if len(data) == 0 {
		return validatedListingFile{}, fmt.Errorf("file is empty")
	}
	if len(data) > maxListingImageBytes {
		return validatedListingFile{}, fmt.Errorf("file exceeds the 10MB maximum")
	}

	detected := http.DetectContentType(data)
	switch detected {
	case "image/jpeg":
		if _, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil {
			return validatedListingFile{}, fmt.Errorf("invalid JPEG image")
		}
		return validatedListingFile{name, "image", detected, ".jpg", data}, nil
	case "image/png":
		if _, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil {
			return validatedListingFile{}, fmt.Errorf("invalid PNG image")
		}
		return validatedListingFile{name, "image", detected, ".png", data}, nil
	case "image/webp":
		if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
			return validatedListingFile{}, fmt.Errorf("invalid WebP image")
		}
		return validatedListingFile{name, "image", detected, ".webp", data}, nil
	case "application/pdf":
		if len(data) > maxListingDocumentSize {
			return validatedListingFile{}, fmt.Errorf("PDF exceeds the 5MB maximum")
		}
		tailStart := len(data) - 2048
		if tailStart < 0 {
			tailStart = 0
		}
		if !bytes.HasPrefix(data, []byte("%PDF-")) || !bytes.Contains(data[tailStart:], []byte("%%EOF")) {
			return validatedListingFile{}, fmt.Errorf("invalid PDF document")
		}
		return validatedListingFile{name, "document", detected, ".pdf", data}, nil
	default:
		return validatedListingFile{}, fmt.Errorf("only JPEG, PNG, WebP and PDF files are allowed")
	}
}

func safeOriginalName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		return "upload"
	}
	runes := []rune(name)
	if len(runes) > 255 {
		name = string(runes[:255])
	}
	return name
}

func serveListingFile(c echo.Context, gormDB *gorm.DB) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil || fileID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid file id"})
	}
	db, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}

	var listingID int
	var originalName, storageName, mimeType string
	if err := db.QueryRow(`
		SELECT f.listing_id, f.original_name, f.storage_name, f.mime_type
		FROM listing_files f
		JOIN listings l ON l.id = f.listing_id
		WHERE f.id = $1`,
		fileID,
	).Scan(&listingID, &originalName, &storageName, &mimeType); err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "file not found"})
	} else if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database error"})
	}
	if filepath.Base(storageName) != storageName {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "file not found"})
	}

	fullPath := filepath.Join(listingFilesRoot, strconv.Itoa(listingID), storageName)
	file, err := os.Open(fullPath)
	if os.IsNotExist(err) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "file content not found"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to open file"})
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read file"})
	}

	c.Response().Header().Set("Content-Type", mimeType)
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	disposition := "inline"
	if c.QueryParam("download") == "1" {
		disposition = "attachment"
	}
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, strings.ReplaceAll(originalName, `"`, "")))
	http.ServeContent(c.Response().Writer, c.Request(), originalName, info.ModTime(), file)
	return nil
}

func deleteListingFile(c echo.Context, gormDB *gorm.DB) error {
	listingID, err := strconv.Atoi(c.Param("id"))
	if err != nil || listingID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid listing id"})
	}
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil || fileID <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid file id"})
	}
	userID, ok := c.Get("userId").(int)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid authorization token"})
	}
	db, err := gormDB.DB()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database connection error"})
	}

	var sellerID int
	var storageName, kind, currentPrimary string
	if err := db.QueryRow(`
		SELECT l.seller_id, f.storage_name, f.file_kind, COALESCE(l.image, '')
		FROM listing_files f
		JOIN listings l ON l.id = f.listing_id
		WHERE f.id = $1 AND f.listing_id = $2`,
		fileID,
		listingID,
	).Scan(&sellerID, &storageName, &kind, &currentPrimary); err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "file not found"})
	} else if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "database error"})
	}
	if sellerID != userID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "forbidden"})
	}
	if filepath.Base(storageName) != storageName {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "file not found"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete file"})
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM listing_files WHERE id = $1 AND listing_id = $2", fileID, listingID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete file"})
	}

	deletedURL := listingFileURL(fileID)
	if kind == "image" && currentPrimary == deletedURL {
		var replacementID sql.NullInt64
		if err := tx.QueryRow(`
			SELECT id FROM listing_files
			WHERE listing_id = $1 AND file_kind = 'image'
			ORDER BY display_order, id LIMIT 1`,
			listingID,
		).Scan(&replacementID); err != nil && err != sql.ErrNoRows {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update cover image"})
		}
		replacementURL := ""
		if replacementID.Valid {
			replacementURL = listingFileURL(replacementID.Int64)
		}
		if _, err := tx.Exec(
			"UPDATE listings SET image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
			replacementURL,
			listingID,
		); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update cover image"})
		}
	}
	if err := tx.Commit(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete file"})
	}

	fullPath := filepath.Join(listingFilesRoot, strconv.Itoa(listingID), storageName)
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "file metadata deleted but storage cleanup failed"})
	}
	return c.NoContent(http.StatusNoContent)
}

func removeListingFileDirectory(listingID int) error {
	dir := filepath.Join(listingFilesRoot, strconv.Itoa(listingID))
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
			return err
		}
	}
	if err := os.Remove(dir); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
