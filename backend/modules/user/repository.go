package user

import (
	"database/sql"
	"fmt"
	"strings"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateUser(req RegisterRequest) (int64, error) {
	// In production, ALWAYS hash passwords using bcrypt
	avatar := "https://ui-avatars.com/api/?name=" + req.FirstName + "+" + req.LastName
	var id int64
	err := r.db.QueryRow(
		"INSERT INTO users (username, email, password_hash, first_name, last_name, avatar_url, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
		req.Username, req.Email, req.Password, req.FirstName, req.LastName, avatar, true,
	).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (r *Repository) GetUserByEmailAndPassword(email, password string) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	var avatarMime sql.NullString
	var avatarData []byte
	err := r.db.QueryRow(
		"SELECT id, username, email, first_name, last_name, avatar_url, avatar_data, avatar_mime_type, bio, created_at FROM users WHERE email = $1 AND password_hash = $2",
		email, password,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &avatarURL, &avatarData, &avatarMime, &bio, &user.CreatedAt)
	
	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
	} else if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	}
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) GetUserByID(id int) (*User, error) {
	var user User
	var bio sql.NullString
	var avatarURL sql.NullString
	var avatarMime sql.NullString
	var avatarData []byte
	err := r.db.QueryRow(
		"SELECT id, username, email, first_name, last_name, avatar_url, avatar_data, avatar_mime_type, bio, created_at FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &user.FirstName, &user.LastName, &avatarURL, &avatarData, &avatarMime, &bio, &user.CreatedAt)
	
	if err != nil {
		return nil, err
	}
	user.Bio = bio.String
	if avatarMime.Valid {
		user.AvatarMime = &avatarMime.String
	}
	user.AvatarData = avatarData
	user.HasAvatarBin = len(avatarData) > 0
	if user.HasAvatarBin {
		avatarPath := fmt.Sprintf("/api/v1/users/%d/avatar", user.ID)
		user.AvatarURL = &avatarPath
	} else if avatarURL.Valid {
		user.AvatarURL = &avatarURL.String
	}
	user.IsOnline = true // For demo
	return &user, nil
}

func (r *Repository) UpdateUserProfile(id int, req UpdateProfileRequest) error {
	_, err := r.db.Exec(
		"UPDATE users SET first_name = $1, last_name = $2, bio = $3, avatar_url = $4 WHERE id = $5",
		req.FirstName, req.LastName, req.Bio, req.AvatarURL, id,
	)
	return err
}

func (r *Repository) UpdateUserAvatarBinary(userID int, data []byte, mime string) error {
	_, err := r.db.Exec(
		"UPDATE users SET avatar_data = $1, avatar_mime_type = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
		data, mime, userID,
	)
	return err
}

func (r *Repository) GetUserAvatarBinary(userID int) ([]byte, string, error) {
	var data []byte
	var mime sql.NullString
	err := r.db.QueryRow(
		"SELECT avatar_data, avatar_mime_type FROM users WHERE id = $1 AND avatar_data IS NOT NULL",
		userID,
	).Scan(&data, &mime)
	if err != nil {
		return nil, "", err
	}

	contentType := "application/octet-stream"
	if mime.Valid && strings.TrimSpace(mime.String) != "" {
		contentType = mime.String
	}

	return data, contentType, nil
}

func (r *Repository) GetFriends(userID int) ([]Friend, error) {
	rows, err := r.db.Query(`
		SELECT u.id, u.username, u.avatar_url, f.created_at 
		FROM friendships f
		JOIN users u ON f.friend_id = u.id
		WHERE f.user_id = $1
		ORDER BY f.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var friends []Friend
	for rows.Next() {
		var f Friend
		var avatarURL sql.NullString
		if err := rows.Scan(&f.ID, &f.Username, &avatarURL, &f.AddedAt); err != nil {
			return nil, err
		}
		if avatarURL.Valid {
			f.AvatarURL = &avatarURL.String
		}
		f.IsOnline = true // For simulation
		friends = append(friends, f)
	}
	if friends == nil {
		friends = []Friend{}
	}
	return friends, nil
}

func (r *Repository) AddFriend(userID, friendID int) error {
	// Check if friend exists
	var exists int
	err := r.db.QueryRow("SELECT id FROM users WHERE id = $1", friendID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("friend user does not exist")
	}

	_, err = r.db.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES ($1, $2)", userID, friendID)
	// Bi-directional for simplicity
	_, err = r.db.Exec("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES ($1, $2)", friendID, userID)
	return err
}

func (r *Repository) RemoveFriend(userID, friendID int) error {
	_, err := r.db.Exec("DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2", userID, friendID)
	_, err = r.db.Exec("DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2", friendID, userID)
	return err
}

func (r *Repository) SaveListingImageBinary(listingID int, data []byte, mime string, isPrimary bool) error {
	_, err := r.db.Exec(
		`INSERT INTO listing_images (listing_id, image_data, mime_type, is_primary, uploaded_at)
		VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
		listingID, data, mime, isPrimary,
	)
	return err
}

func (r *Repository) SaveListingImageBinary(listingID int, data []byte, mime string, isPrimary bool) error
{

}

/*
I'll write a short actionable todo list for the work (planning) so we have a clear checklist to follow next. Expected outcome: a tracked list of steps we'll take to implement DB-backed listing images.

Starting (1/5) *Plan and inspect files*

Progress update: I added a tracked todo list with five steps (planning, repo method, handler/route, frontend change, testing/optimizations). Next I'll show concrete code examples and step-by-step instructions you can apply to your project.

Below are clear, copy-pasteable examples and guidance for serving listing images from the DB (Postgres BYTEA) and using them in the frontend.

High-level approach
- Store images in `listing_images.image_data` (BYTEA) and `listing_images.mime_type` (varchar). You already have these columns.
- Add a repository method to fetch the binary + mime for a listing (prefer the primary image).
- Add a backend HTTP endpoint that returns the image bytes with the correct Content-Type.
- In the frontend, point the <img> src to that endpoint. The browser will request the image and display it.
- Add fallback logic: if no binary image exists, fall back to `listing_images.image_url` or `listings.image` (external URL) or a placeholder.

Backend — repository method (Go)
- Pattern: similar to your `GetUserAvatarBinary` in repository.go.
- Put under a suitable package (e.g., `modules/listings/repository.go`) or add to an existing repo if you centralize listing logic.

Example repository method:

```go
// GetListingImage attempts to return the primary binary image for a listing.
// If none exists, it returns sql.ErrNoRows so the handler can fall back to image_url.
func (r *Repository) GetListingImage(listingID int) ([]byte, string, error) {
    var data []byte
    var mime sql.NullString
    // First prefer primary image
    err := r.db.QueryRow(
        `SELECT image_data, mime_type FROM listing_images WHERE listing_id = $1 AND is_primary = TRUE LIMIT 1`,
        listingID,
    ).Scan(&data, &mime)
    if err == sql.ErrNoRows {
        // Try any image for listing (fallback)
        err = r.db.QueryRow(
            `SELECT image_data, mime_type FROM listing_images WHERE listing_id = $1 LIMIT 1`,
            listingID,
        ).Scan(&data, &mime)
    }
    if err != nil {
        return nil, "", err
    }

    contentType := "application/octet-stream"
    if mime.Valid && strings.TrimSpace(mime.String) != "" {
        contentType = mime.String
    }
    return data, contentType, nil
}
```

Backend — handler (Echo)
- Return the binary with proper Content-Type and caching headers. Echo's Context has Blob which is convenient.

Example handler (add to your listings handler file, e.g., `backend/modules/listings/handler.go`):

```go
import (
    "net/http"
    "strconv"

    "github.com/labstack/echo/v4"
)

type ListingsHandler struct {
    repo *Repository // or appropriate interface
}

func NewListingsHandler(repo *Repository) *ListingsHandler {
    return &ListingsHandler{repo: repo}
}

func (h *ListingsHandler) GetListingImage(c echo.Context) error {
    idStr := c.Param("id")
    id, err := strconv.Atoi(idStr)
    if err != nil {
        return c.NoContent(http.StatusBadRequest)
    }

    data, contentType, err := h.repo.GetListingImage(id)
    if err == sql.ErrNoRows {
        // No binary image stored — try to return external URL or 404
        // Option A: redirect to the image_url stored in listings table (if you implement it)
        // Option B: return 404 and let frontend use fallback URL
        return c.NoContent(http.StatusNotFound)
    }
    if err != nil {
        return c.NoContent(http.StatusInternalServerError)
    }

    // Add simple caching: Cache for 1 hour (adjust to taste); consider ETag/Last-Modified for better caching
    c.Response().Header().Set(echo.HeaderCacheControl, "public, max-age=3600")
    return c.Blob(http.StatusOK, contentType, data)
}
```

Backend — route
- Register route in your router setup (e.g., `main.go` or wherever you set Echo routes):

```go
e.GET("/api/v1/listings/:id/image", listingsHandler.GetListingImage)
```

Frontend — use the endpoint in your listing component
- For simple usage, set `img.src` to the endpoint URL. Example React/Next.js snippet:

```tsx
// In your ListingCard or Listing component
const ListingImage = ({ id, fallbackUrl, alt }) => {
  const apiUrl = `/api/v1/listings/${id}/image`
  return (
    <img
      src={apiUrl}
      onError={(e) => { e.currentTarget.src = fallbackUrl || "/images/placeholder.png" }}
      alt={alt || "listing image"}
      style={{ width: "100%", height: "auto", objectFit: "cover" }}
    />
  )
}
```

- If you use Next.js `next/image`, you'll need a loader that returns the API path, or configure domains and use the external URL fallback. Simpler: use a normal <img> if you want to stream images from your API.

Fallback logic
- Handler returns 404 when no binary image exists. Frontend onError switches to `listing.image` or a placeholder.
- Alternatively, implement handler logic to return a redirect to `listings.image` URL when binary missing:

```go
// inside GetListingImage, after determining no binary exists, you could:
var imageURL sql.NullString
err = h.repo.GetListingImageURL(id, &imageURL)
if err == nil && imageURL.Valid {
    return c.Redirect(http.StatusFound, imageURL.String)
}
```

Database queries for fallback (example)
- Query for an external URL in `listing_images.image_url` or `listings.image`:

```sql
SELECT image_url FROM listing_images WHERE listing_id = $1 AND is_primary = TRUE LIMIT 1;
-- or
SELECT image FROM listings WHERE id = $1;
```

Production considerations and trade-offs
- Storing images in DB is fine for small projects. At scale, prefer object storage (S3/GCS) and store URLs in DB for cost/perf.
- DB storage increases DB size and backup time. It can be slower. Use streaming (io.Copy) for very large images.
- Set Cache-Control headers and ETags. Consider using a CDN in front of the image endpoint.
- For security, ensure only authorized users can see restricted images (if any). Consider rate-limiting to avoid abuse.

Extra improvements
- Add ETag: compute a hash of the bytes (or store a version column) and return 304 when client has the same ETag.
- Add image resizing or thumbnails (generate and store small versions for listing previews).
- Validate/normalize mime type on upload and verify size limits.

Testing locally
- Seed `listing_images` with some rows where `image_data` is the bytea of an image and `mime_type` is like `image/jpeg` or `image/png`.
- Example psql insert (use base64 decode if easier):

```sql
-- Using psql, you can read a file and insert: (from shell)
-- psql -d mydb -c "INSERT INTO listing_images (listing_id, image_data, mime_type, is_primary) VALUES (1, decode('...base64...','base64'), 'image/png', true);"
```

- Or load files using Go upload endpoint and store them via `UpdateListingImageBinary(listingID, data, mime)` method analogous to `UpdateUserAvatarBinary`.

Summary checklist (what to do next)
- Add repo method `GetListingImage` (or augment existing listing/user repo).
- Add handler `GetListingImage` and route `GET /api/v1/listings/:id/image`.
- Update frontend listing component to use that endpoint and add onError fallback to external URL or placeholder.
- Seed a sample image into `listing_images.image_data` to test.
- Add caching/ETag for production.

If you want, I can:
- Implement the backend repo + handler + route edits in your repo and run a local build/test.
- Add a simple frontend change (component) that uses the endpoint.
Tell me which you'd prefer and I will apply code changes directly.
*/