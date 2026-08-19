package admin

import (
	"crypto/subtle"
	"database/sql"
	"fmt"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"transcendence/modules/admin/ml"
	"transcendence/modules/apikey"
	"transcendence/modules/user/auth"
	"transcendence/myMiddleware"
)

type Handler struct {
	db *sql.DB
}

func NewHandler(db *sql.DB) *Handler {
	return &Handler{db: db}
}

const deletedUserDisplayName = "Deleted user"

type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type adminUser struct {
	ID            int        `json:"id"`
	Username      string     `json:"username"`
	Email         string     `json:"email"`
	FirstName     string     `json:"firstName"`
	LastName      string     `json:"lastName"`
	Role          string     `json:"role"`
	AccountStatus string     `json:"accountStatus"`
	DeletedAt     *time.Time `json:"deletedAt,omitempty"`
}

type createAdminUserRequest struct {
	Username  string `json:"username"`
	Email     string `json:"email"`
	Password  string `json:"password"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Role      string `json:"role"`
}

type updateAdminUserRequest struct {
	Username  string `json:"username"`
	Email     string `json:"email"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
}

type updateAccountStatusRequest struct {
	AccountStatus string `json:"accountStatus"`
}

type updateRoleRequest struct {
	Role string `json:"role"`
}

type adminSummary struct {
	TotalUsers       int     `json:"totalUsers"`
	ActiveUsers      int     `json:"activeUsers"`
	SuspendedUsers   int     `json:"suspendedUsers"`
	DeletedUsers     int     `json:"deletedUsers"`
	ActiveListings   int     `json:"activeListings"`
	CompletedOrders  int     `json:"completedOrders"`
	CompletedRevenue float64 `json:"completedRevenue"`
}

// admin routes are registered under /api/v1/admin, and require a valid admin JWT token for access. The login route is available at /api/v1/admin/auth/login for initial authentication.
func (h *Handler) RegisterRoutes(v1 *echo.Group) {
	v1.POST("/admin/auth/login", adminLogin) // this one is for the bootstrap login
	admin := v1.Group("/admin")
	admin.Use(myMiddleware.AdminAuth(h.db))
	admin.GET("/summary", func(c echo.Context) error { return h.getAdminSummary(c) }) // first load
	admin.GET("/users", func(c echo.Context) error { return h.listAdminUsers(c) })    // first load
	admin.GET("/users/:id", func(c echo.Context) error { return h.getAdminUser(c) })
	admin.POST("/users", func(c echo.Context) error { return h.createAdminUser(c) })
	admin.PATCH("/users/:id", func(c echo.Context) error { return h.updateAdminUser(c) })
	admin.PATCH("/users/:id/role", func(c echo.Context) error { return h.updateAdminUserRole(c) })
	admin.PATCH("/users/:id/status", func(c echo.Context) error { return h.updateAdminUserStatus(c) })
	admin.DELETE("/users/:id", func(c echo.Context) error { return h.deleteAdminUser(c) })
	admin.GET("/api-attempts", func(c echo.Context) error { return apikey.GetAPIAttackAttempts(c, h.db) }) //get security report of failed public api calls
	admin.GET("/ml/status", func(c echo.Context) error { return ml.GetStatus(c, h.db) })
	admin.GET("/ml/feedback", func(c echo.Context) error { return ml.ListFeedback(c, h.db) }) // last 25 survey rows
	admin.GET("/ml/runs", func(c echo.Context) error { return ml.ListRuns(c, h.db) }) // last 20 training jobs
	admin.POST("/ml/retrain", func(c echo.Context) error { return ml.CreateRetrainingRun(c, h.db) }) // retrain
	admin.GET("/ml/runs/:id", func(c echo.Context) error { return ml.GetRun(c, h.db) }) //one job by id
}

func adminLogin(c echo.Context) error {
	// read json from the login page, username and password, and bind to the struct
	var req adminLoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}
	// if match the username and password with the environment variable, then generate a JWT token and return to the frontend
	expectedUsername := strings.TrimSpace(os.Getenv("ADMIN_USERNAME"))
	passwordHash := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_HASH"))
	if expectedUsername == "" || passwordHash == "" {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "Administrator login is not configured"})
	}
	// check if they are matched, with bcrypt for password, and constant time compare for username to prevent timing attacks
	usernameMatches := subtle.ConstantTimeCompare([]byte(req.Username), []byte(expectedUsername)) == 1
	passwordMatches := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) == nil
	// The plaintext comparison is retained for the repository's disposable MVP
	// and CI credentials. A bcrypt hash remains the preferred configuration.
	if !passwordMatches {
		passwordMatches = subtle.ConstantTimeCompare([]byte(req.Password), []byte(passwordHash)) == 1
	}
	// wrong then no token
	if !usernameMatches || !passwordMatches {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid administrator credentials"})
	}
	token, err := auth.GenerateAdminToken()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}
	return c.JSON(http.StatusOK, map[string]string{"token": token})
}

func isAdminRole(c echo.Context) bool {
	role, _ := c.Get("userRole").(string)
	return role == "admin"
}

func requireAdminRole(c echo.Context) bool {
	return isAdminRole(c)
}

func parseUserID(c echo.Context) (int, error) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID <= 0 {
		return 0, fmt.Errorf("invalid user ID")
	}
	return userID, nil
}

func isValidRole(role string) bool {
	return role == "user" || role == "moderator" || role == "admin"
}

func scanAdminUser(scanner interface{ Scan(...interface{}) error }) (adminUser, error) {
	var u adminUser
	var deletedAt sql.NullTime
	err := scanner.Scan(
		&u.ID, &u.Username, &u.Email, &u.FirstName, &u.LastName,
		&u.Role, &u.AccountStatus, &deletedAt,
	)
	if deletedAt.Valid {
		u.DeletedAt = &deletedAt.Time
		u.Username = deletedUserDisplayName
		u.Email = ""
		u.FirstName = ""
		u.LastName = ""
	}
	return u, err
}

const adminUserSelect = `
	SELECT id, username, email, COALESCE(first_name, ''), COALESCE(last_name, ''),
		role, account_status, deleted_at
	FROM users`

func (h *Handler) listAdminUsers(c echo.Context) error {
	query := adminUserSelect + " WHERE 1=1"
	args := []interface{}{}
	if status := c.QueryParam("status"); status != "" {
		if status != "active" && status != "suspended" && status != "deleted" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "status must be active, suspended, or deleted"})
		}
		query += " AND account_status = $1"
		args = append(args, status)
	}
	if role := c.QueryParam("role"); role != "" {
		if !isValidRole(role) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be user, moderator, or admin"})
		}
		query += " AND role = $" + strconv.Itoa(len(args)+1)
		args = append(args, role)
	}
	if search := strings.TrimSpace(c.QueryParam("search")); search != "" {
		position := strconv.Itoa(len(args) + 1)
		query += " AND (username ILIKE $" + position + " OR email ILIKE $" + position + ")"
		args = append(args, "%"+search+"%")
	}
	query += " ORDER BY id ASC"
	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch users"})
	}
	defer rows.Close()
	users := []adminUser{}
	for rows.Next() {
		u, scanErr := scanAdminUser(rows)
		if scanErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read users"})
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read users"})
	}
	role, _ := c.Get("userRole").(string)
	return c.JSON(http.StatusOK, map[string]interface{}{"users": users, "viewerRole": role})
}

func (h *Handler) getAdminUser(c echo.Context) error {
	userID, err := parseUserID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	u, err := scanAdminUser(h.db.QueryRow(adminUserSelect+" WHERE id = $1", userID))
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch user"})
	}
	return c.JSON(http.StatusOK, u)
}

func (h *Handler) getAdminSummary(c echo.Context) error {
	var summary adminSummary
	err := h.db.QueryRow(`
		SELECT
			(SELECT COUNT(*) FROM users WHERE account_status <> 'deleted'),
			(SELECT COUNT(*) FROM users WHERE account_status = 'active'),
			(SELECT COUNT(*) FROM users WHERE account_status = 'suspended'),
			(SELECT COUNT(*) FROM users WHERE account_status = 'deleted'),
			(SELECT COUNT(*) FROM listings WHERE status = 'active'),
			(SELECT COUNT(*) FROM orders WHERE status = 'completed'),
			COALESCE((SELECT SUM(total_price) FROM orders WHERE status = 'completed'), 0)
	`).Scan(
		&summary.TotalUsers,
		&summary.ActiveUsers,
		&summary.SuspendedUsers,
		&summary.DeletedUsers,
		&summary.ActiveListings,
		&summary.CompletedOrders,
		&summary.CompletedRevenue,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch admin summary"})
	}
	return c.JSON(http.StatusOK, summary)
}

func (h *Handler) createAdminUser(c echo.Context) error {
	if !requireAdminRole(c) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator access required"})
	}
	var req createAdminUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Username == "" || req.Email == "" || len(req.Password) < 8 || !isValidRole(req.Role) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "username, valid email, password of at least 8 characters, and valid role are required"})
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid email"})
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to secure password"})
	}
	var userID int
	err = h.db.QueryRow(`
		INSERT INTO users (
			username, email, password_hash, first_name, last_name,
			is_verified, requires_2fa, role
		) VALUES ($1, $2, $3, $4, $5, true, false, $6)
		RETURNING id`,
		req.Username, req.Email, string(passwordHash), req.FirstName, req.LastName, req.Role,
	).Scan(&userID)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Username or email already exists"})
	}
	u, err := scanAdminUser(h.db.QueryRow(adminUserSelect+" WHERE id = $1", userID))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "User created but could not be loaded"})
	}
	return c.JSON(http.StatusCreated, u)
}

func (h *Handler) updateAdminUser(c echo.Context) error {
	if !requireAdminRole(c) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator access required"})
	}
	userID, err := parseUserID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	var req updateAdminUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	if req.Username == "" || req.Email == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Username and email are required"})
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid email"})
	}
	result, err := h.db.Exec(`
		UPDATE users
		SET username = $1, email = $2, first_name = $3, last_name = $4,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $5 AND account_status <> 'deleted'`,
		req.Username, req.Email, req.FirstName, req.LastName, userID,
	)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Username or email already exists"})
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Active user not found"})
	}
	u, err := scanAdminUser(h.db.QueryRow(adminUserSelect+" WHERE id = $1", userID))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "User updated but could not be loaded"})
	}
	return c.JSON(http.StatusOK, u)
}

func (h *Handler) updateAdminUserRole(c echo.Context) error {
	if !requireAdminRole(c) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator access required"})
	}
	userID, err := parseUserID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if actorID, _ := c.Get("adminUserId").(int); actorID != 0 && actorID == userID {
		return c.JSON(http.StatusConflict, map[string]string{"error": "You cannot change your own role"})
	}
	var req updateRoleRequest
	if err := c.Bind(&req); err != nil || !isValidRole(req.Role) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be user, moderator, or admin"})
	}
	result, err := h.db.Exec(`
		UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2 AND account_status <> 'deleted'`,
		req.Role, userID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update role"})
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Active user not found"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Role updated", "role": req.Role})
}

func (h *Handler) updateAdminUserStatus(c echo.Context) error {
	userID, err := parseUserID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if actorID, _ := c.Get("adminUserId").(int); actorID != 0 && actorID == userID {
		return c.JSON(http.StatusConflict, map[string]string{"error": "You cannot suspend your own account"})
	}
	var req updateAccountStatusRequest
	if err := c.Bind(&req); err != nil || (req.AccountStatus != "active" && req.AccountStatus != "suspended") {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "accountStatus must be active or suspended"})
	}
	var targetRole, currentStatus string
	if err := h.db.QueryRow("SELECT role, account_status FROM users WHERE id = $1", userID).Scan(&targetRole, &currentStatus); err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	} else if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read user"})
	}
	if currentStatus == "deleted" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Deleted users cannot be restored"})
	}
	if !isAdminRole(c) && targetRole != "user" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Moderators may only manage ordinary users"})
	}
	if _, err := h.db.Exec(
		"UPDATE users SET account_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		req.AccountStatus, userID,
	); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update user"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Account status updated", "accountStatus": req.AccountStatus})
}

func (h *Handler) deleteAdminUser(c echo.Context) error {
	if !requireAdminRole(c) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Administrator access required"})
	}
	userID, err := parseUserID(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if actorID, _ := c.Get("adminUserId").(int); actorID != 0 && actorID == userID {
		return c.JSON(http.StatusConflict, map[string]string{"error": "You cannot delete your own account"})
	}

	tx, err := h.db.Begin()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to start deletion"})
	}
	defer tx.Rollback()

	var status string
	var avatarURL sql.NullString
	if err := tx.QueryRow(
		"SELECT account_status, avatar_url FROM users WHERE id = $1 FOR UPDATE",
		userID,
	).Scan(&status, &avatarURL); err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	} else if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read user"})
	}
	if status == "deleted" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "User is already deleted"})
	}

	var unresolvedOrders int
	if err := tx.QueryRow(`
		SELECT COUNT(*) FROM orders
		WHERE (buyer_id = $1 OR seller_id = $1)
		  AND status NOT IN ('completed', 'cancelled', 'refunded')`,
		userID,
	).Scan(&unresolvedOrders); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify transaction history"})
	}
	if unresolvedOrders > 0 {
		return c.JSON(http.StatusConflict, map[string]interface{}{
			"error":            "Resolve pending orders before deleting this user",
			"unresolvedOrders": unresolvedOrders,
		})
	}

	statements := []struct {
		query string
		args  []interface{}
	}{
		{`UPDATE listings
			SET seller_name = $1, phone_number = '',
				status = CASE WHEN status = 'active' THEN 'archived' ELSE status END,
				updated_at = CURRENT_TIMESTAMP
			WHERE seller_id = $2`, []interface{}{deletedUserDisplayName, userID}},
		{"UPDATE api_keys SET is_active = false WHERE user_id = $1", []interface{}{userID}},
		{"DELETE FROM friendships WHERE user_id1 = $1 OR user_id2 = $1", []interface{}{userID}},
		{"DELETE FROM notifications WHERE user_id = $1", []interface{}{userID}},
		{"UPDATE notifications SET actor_id = NULL WHERE actor_id = $1", []interface{}{userID}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement.query, statement.args...); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to anonymize related account data"})
		}
	}

	internalUsername := fmt.Sprintf("deleted_user_%d", userID)
	internalEmail := fmt.Sprintf("deleted_%d@deleted.invalid", userID)
	unusablePassword := fmt.Sprintf("!deleted-account-%d", userID)
	if _, err := tx.Exec(`
		UPDATE users SET
			username = $1,
			email = $2,
			password_hash = $3,
			first_name = '',
			last_name = '',
			phone_no = NULL,
			address = NULL,
			postcode = NULL,
			state = NULL,
			district = NULL,
			date_of_birth = NULL,
			gender = NULL,
			avatar_url = NULL,
			avatar_data = NULL,
			avatar_storage_name = NULL,
			avatar_mime_type = NULL,
			bio = '',
			requires_2fa = false,
			role = 'user',
			account_status = 'deleted',
			oauth_id = NULL,
			oauth_provider = NULL,
			deleted_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $4`,
		internalUsername, internalEmail, unusablePassword, userID,
	); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to anonymize user"})
	}
	if err := tx.Commit(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to complete deletion"})
	}

	// Delete the stored profile
	_ = os.RemoveAll(filepath.Join("storage", "avatars", strconv.Itoa(userID)))

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message":        "User deleted and anonymized",
		"userId":         userID,
		"displayName":    deletedUserDisplayName,
		"ordersRetained": true,
	})
}
