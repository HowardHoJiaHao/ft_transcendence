package user

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	FirstName    string    `json:"firstName"`
	LastName     string    `json:"lastName"`
	PhoneNo      string    `json:"phoneNo"`
	DateOfBirth  time.Time `json:"dateOfBirth"`
	Gender       string    `json:"gender"`
	AvatarURL    *string   `json:"avatar,omitempty"`
	AvatarMime   *string   `json:"avatarMimeType,omitempty"`
	Bio          string    `json:"bio"`
	IsOnline     bool      `json:"onlineStatus"`
	CreatedAt    time.Time `json:"createdAt"`
	HasAvatarBin bool      `json:"hasAvatarBinary,omitempty"`
	Requires2FA  bool      `json:"require2FA"`

	AvatarData []byte `json:"-"`
}

type RegisterRequest struct {
	Username     string     `json:"username"`
	Email        string     `json:"email"`
	Password     string     `json:"password"`
	FirstName    string     `json:"firstName"`
	LastName     string     `json:"lastName"`
	PhoneNo      *string    `json:"phoneNo"`
	DateOfBirth  *time.Time `json:"dateOfBirth"`
	Gender       *string    `json:"gender"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token     string `json:"token,omitempty"`
	User      User   `json:"user,omitempty"`
	NeedOtp   bool   `json:"needOtp,omitempty"`
	TempToken string `json:"tempToken,omitempty"`
}

type UpdateProfileRequest struct {
	FirstName    string     `json:"firstName"`
	LastName     string     `json:"lastName"`
	Bio          string     `json:"bio"`
	DateOfBirth  *time.Time `json:"dateOfBirth"`
	Gender       *string    `json:"gender"`
	AvatarURL    *string    `json:"avatar"`
	Email        *string    `json:"email"`
	PhoneNo      *string    `json:"phoneNo"`
}

type Friend struct {
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar,omitempty"`
	IsOnline  bool      `json:"onlineStatus"`
	AddedAt   time.Time `json:"addedAt"`
}

type OTP struct {
	Email      string    `gorm:"primaryKey;type:varchar(255);column:email"`
	Code       string    `gorm:"type:char(6);not null;column:code"`
	ExpiryDate time.Time `gorm:"not null;column:expiry_date"`
	Used       bool      `gorm:"default:false;column:used"`
	TempToken  string    `gorm:"type:varchar(255);not null;column:temp_token"`
}

type OTPrequest struct {
	TempToken string `json:"tempToken"`
	OtpCode   string `json:"otpCode"`
}

type ResendOtpRequest struct {
	Email string `json:"email"`
}

func (OTP) TableName() string {
	return "otps"
}

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(&OTP{})
}