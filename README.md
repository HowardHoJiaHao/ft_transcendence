# Transcendence Marketplace

A full-stack marketplace application built with Next.js (frontend), Go (backend), and MySQL (database).

## Project Structure

```
transcendence/
├── frontend/          # Next.js React application
├── backend/           # Go Echo server
├── db/               # MySQL database initialization
├── docker-compose.yml # Docker orchestration
└── .env.example      # Environment variables template
```

## Prerequisites

- Docker & Docker Compose
- Git

## Quick Start

### 1. Clone and Setup

```bash
cd /home/abin-moh/test/trans
cp .env.example .env
```

### 2. Start Services

```bash
docker-compose up -d
```

This will start:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **Database**: MySQL on localhost:3306

### 3. Verify Services

```bash
# Check all containers are running
docker-compose ps

# Check backend health
curl http://localhost:8080/health

# Check frontend
open http://localhost:3000
```

## Services

### Frontend (Next.js)
- **Port**: 3000
- **Path**: `./frontend`
- **Dev Mode**: `npm run dev`
- **Build**: `npm run build`

### Backend (Go)
- **Port**: 8080
- **Path**: `./backend`
- **Main File**: `main.go`
- **Uses**: Echo framework + MySQL driver

### Database (MySQL)
- **Port**: 3306
- **Default User**: `transcendence`
- **Default Password**: `transcendence_pass`
- **Default Database**: `transcendence`
- **Initialization**: `./db/init.sql`

## Environment Variables

Configure in `.env` file:

```env
# Database
DB_ROOT_PASSWORD=root
DB_USER=transcendence
DB_PASSWORD=transcendence_pass
DB_NAME=transcendence

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080
NODE_ENV=development

# Backend
ENVIRONMENT=development
SERVER_PORT=8080
```

## Database Tables

The following tables are automatically created on startup:

- **users** - User accounts and authentication
- **listings** - Product/service listings
- **listing_images** - Images for listings
- **messages** - User-to-user messaging
- **reviews** - User reviews and ratings
- **orders** - Purchase orders
- **api_keys** - API authentication keys
- **analytics_events** - Event tracking and analytics

## API Endpoints

### Health Check
```bash
curl http://localhost:8080/health
```

### Status
```bash
curl http://localhost:8080/api/v1/status
```

## Common Commands

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db
```

### Stop Services
```bash
docker-compose down
```

### Stop and Remove Data
```bash
docker-compose down -v
```

### Rebuild Services
```bash
docker-compose build
```

### Access Database
```bash
docker-compose exec db mysql -u transcendence -p transcendence
```

### Access Backend Container
```bash
docker-compose exec backend sh
```

### Access Frontend Container
```bash
docker-compose exec frontend sh
```

## Development

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

### Backend Development

```bash
cd backend
go get ./...
go run main.go
```

### Database Connection

Connection string for Go backend:
```
user:password@tcp(host:port)/database?parseTime=true
```

## Features Ready for Implementation

- ✅ Docker infrastructure
- ✅ Database schema with core tables
- ✅ Basic API endpoints
- ✅ Frontend structure with Next.js
- ⏳ User authentication & 2FA
- ⏳ File upload system
- ⏳ Advanced search & filtering
- ⏳ ML recommendation system
- ⏳ Public API with rate limiting
- ⏳ WAF + HashiCorp Vault
- ⏳ Analytics dashboard
- ⏳ Monitoring (Prometheus/Grafana)
- ⏳ OAuth 2.0 (Google/42)

## Troubleshooting

### Port Already in Use
```bash
# Find process using port
lsof -i :3000
lsof -i :8080
lsof -i :3306

# Kill process
kill -9 <PID>
```

### Database Connection Failed
```bash
# Check MySQL is running
docker-compose ps db

# Check logs
docker-compose logs db

# Recreate with fresh data
docker-compose down -v
docker-compose up -d
```

### Frontend Won't Connect to Backend
Check `NEXT_PUBLIC_API_URL` in `.env` matches your setup and CORS is enabled.

## Next Steps

1. Implement user authentication system
2. Add real-time messaging with WebSockets
3. Implement file upload with storage
4. Add search and filtering
5. Integrate payment processing
6. Add notification system
7. Implement ML recommendations
8. Set up monitoring and logging
9. Add security features (2FA, WAF, Vault)
10. Deploy to production

## License

42 Project - Transcendence
