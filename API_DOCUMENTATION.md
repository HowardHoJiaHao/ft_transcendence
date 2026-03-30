# Transcendence API Documentation

## Overview

The Transcendence marketplace API is built with Go Echo framework and provides RESTful endpoints for marketplace operations. The API is versioned and includes rate limiting and authentication.

## Base URL

```
http://localhost:8080/api/v1
```

## Authentication

API authentication will be implemented using:
- JWT tokens for user sessions
- API keys for service-to-service communication
- OAuth 2.0 for third-party providers (Google, 42)

## Rate Limiting

Rate limiting will be implemented per API key:
- Default: 100 requests/minute
- Premium: 1000 requests/minute

## Response Format

All responses follow a consistent JSON format:

### Success Response

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Example"
  },
  "message": "Operation successful"
}
```

### Error Response

```json
{
  "success": false,
  "error": "RESOURCE_NOT_FOUND",
  "message": "The requested resource was not found",
  "code": 404
}
```

## Endpoints (To Be Implemented)

### Health & Status

#### GET /health
Check API health status.

**Response:**
```json
{
  "status": "ok"
}
```

#### GET /api/v1/status
Get API version and status information.

**Response:**
```json
{
  "status": "running",
  "version": "1.0.0"
}
```

### Authentication

#### POST /api/v1/auth/register
Register a new user account.

**Request Body:**
```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "secure_password",
  "first_name": "John",
  "last_name": "Doe"
}
```

**Response:** `201 Created`
```json
{
  "id": 1,
  "username": "john_doe",
  "email": "john@example.com",
  "token": "jwt_token_here"
}
```

#### POST /api/v1/auth/login
Login to account.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "secure_password"
}
```

**Response:** `200 OK`
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": 1,
    "username": "john_doe",
    "email": "john@example.com"
  }
}
```

#### POST /api/v1/auth/oauth
OAuth authentication endpoint.

**Query Parameters:**
- `provider`: `google` or `42`
- `code`: OAuth authorization code

#### POST /api/v1/auth/2fa/setup
Setup two-factor authentication.

**Response:**
```json
{
  "qr_code": "data:image/png;base64,...",
  "secret": "XXXXXXXXXXXXXXXX",
  "backup_codes": ["code1", "code2", ...]
}
```

### Users

#### GET /api/v1/users/:id
Get user profile information.

**Response:**
```json
{
  "id": 1,
  "username": "john_doe",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "avatar_url": "https://...",
  "bio": "I love trading!",
  "rating": 4.8,
  "total_reviews": 42,
  "is_verified": true,
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### PUT /api/v1/users/:id
Update user profile.

**Request Body:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "bio": "Updated bio",
  "avatar_url": "https://..."
}
```

### Listings

#### GET /api/v1/listings
Get all listings with filtering, sorting, and pagination.

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `sort`: Sort field (price, created_at, rating)
- `order`: asc or desc
- `category`: Filter by category
- `min_price`: Minimum price
- `max_price`: Maximum price
- `search`: Full-text search

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "title": "Laptop",
      "description": "Gaming laptop",
      "price": 1200.00,
      "currency": "USD",
      "category": "electronics",
      "seller": {
        "id": 5,
        "username": "seller_name",
        "rating": 4.5
      },
      "images": [
        {
          "id": 1,
          "url": "https://...",
          "is_primary": true
        }
      ],
      "views_count": 156,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

#### POST /api/v1/listings
Create new listing.

**Authorization Required**

**Request Body:**
```json
{
  "title": "Laptop",
  "description": "Gaming laptop for sale",
  "category": "electronics",
  "price": 1200.00,
  "currency": "USD"
}
```

**Response:** `201 Created`

#### GET /api/v1/listings/:id
Get listing details.

#### PUT /api/v1/listings/:id
Update listing.

**Authorization Required** (Seller only)

#### DELETE /api/v1/listings/:id
Delete listing.

**Authorization Required** (Seller only)

### Messages

#### POST /api/v1/messages
Send a message.

**Authorization Required**

**Request Body:**
```json
{
  "receiver_id": 2,
  "content": "Are you interested in selling?"
}
```

#### GET /api/v1/messages
Get user messages.

**Query Parameters:**
- `user_id`: Filter by user
- `unread_only`: true/false

#### PUT /api/v1/messages/:id/read
Mark message as read.

### Reviews

#### POST /api/v1/reviews
Create a review.

**Authorization Required**

**Request Body:**
```json
{
  "reviewee_id": 2,
  "listing_id": 1,
  "rating": 5,
  "comment": "Great seller!"
}
```

#### GET /api/v1/reviews/:user_id
Get user reviews.

**Query Parameters:**
- `limit`: Number of reviews
- `offset`: Pagination offset

### Orders

#### POST /api/v1/orders
Create an order.

**Authorization Required**

**Request Body:**
```json
{
  "listing_id": 1,
  "quantity": 1
}
```

#### GET /api/v1/orders
Get user orders.

**Query Parameters:**
- `status`: pending, completed, cancelled, refunded
- `page`: Page number
- `limit`: Items per page

#### GET /api/v1/orders/:id
Get order details.

#### PUT /api/v1/orders/:id/cancel
Cancel order.

### Analytics

#### GET /api/v1/analytics/dashboard
Get analytics dashboard data.

**Authorization Required** (Seller)

**Response:**
```json
{
  "total_sales": 15000.00,
  "total_orders": 25,
  "average_rating": 4.8,
  "total_views": 3500,
  "monthly_revenue": [
    {
      "month": "2024-01",
      "revenue": 5000.00
    }
  ]
}
```

## Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 400 | BAD_REQUEST | Invalid request parameters |
| 401 | UNAUTHORIZED | Authentication required |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource already exists |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |

## Rate Limiting Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642256400
```

## CORS

The API allows requests from:
- `http://localhost:3000` (development)
- Other configured origins in production

## Pagination

List endpoints support pagination:

```json
{
  "page": 1,
  "limit": 20,
  "total": 500,
  "pages": 25
}
```

## Filtering & Sorting

Most list endpoints support:
- **Filtering**: `?category=electronics&min_price=100&max_price=2000`
- **Sorting**: `?sort=price&order=asc`
- **Search**: `?search=gaming%20laptop`
- **Pagination**: `?page=1&limit=50`

## Webhooks (Future)

Webhooks will be implemented for:
- Order status changes
- Review posted
- Message received
- Listing sold

## SDK/Client Libraries

Official client libraries will be available for:
- JavaScript/TypeScript
- Python
- Go

## Support

For API issues, contact: api-support@transcendence.42school.com
