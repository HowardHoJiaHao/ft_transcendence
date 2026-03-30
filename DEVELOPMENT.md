# Development Setup Guide

## Prerequisites

### Required
- Docker Desktop or Docker + Docker Compose
- Git
- Your favorite code editor (VS Code recommended)

### Optional
- Node.js 18+ (for frontend development outside Docker)
- Go 1.21+ (for backend development outside Docker)
- MySQL CLI client
- Postman or Insomnia (API testing)

## Initial Setup

### 1. Clone the Repository

```bash
cd /home/abin-moh/test/trans
```

### 2. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` with your preferred values.

### 3. Start the Project

**Option A: Using Make (Recommended)**

```bash
make setup
# or separately:
# make build
# make up
```

**Option B: Using Docker Compose**

```bash
docker-compose build
docker-compose up -d
```

**Option C: Using Setup Script**

```bash
chmod +x setup.sh
./setup.sh
```

### 4. Verify Services

```bash
make ps
# or
docker-compose ps
```

All services should show `Up`:
```
NAME                        STATUS
transcendence-frontend     Up
transcendence-backend      Up
transcendence-mysql        Up
```

## Development Workflow

### Frontend Development

#### 1. Development Mode with Hot Reload

```bash
# In the container
docker-compose exec frontend npm run dev

# Or on your machine (requires Node.js 18+)
cd frontend
npm install
npm run dev
```

Visit: http://localhost:3000

#### 2. Build for Production

```bash
docker-compose exec frontend npm run build
docker-compose exec frontend npm run start
```

#### 3. Linting

```bash
docker-compose exec frontend npm run lint
```

#### 4. Frontend Structure

```
frontend/
├── src/
│   ├── app/              # App directory (Next.js 13+)
│   │   ├── layout.tsx    # Root layout
│   │   ├── page.tsx      # Home page
│   │   └── ...
│   ├── components/       # Reusable components
│   ├── hooks/            # Custom React hooks
│   ├── services/         # API services
│   ├── types/            # TypeScript types
│   └── styles/           # Global styles
├── public/               # Static assets
├── package.json
├── tsconfig.json
└── next.config.js
```

#### 5. Adding Dependencies

```bash
docker-compose exec frontend npm install package-name
```

### Backend Development

#### 1. Development Mode with Auto-Reload

```bash
# The default compose setup runs with hot reload
docker-compose up backend

# Or manually in the container
docker-compose exec backend go run main.go
```

Backend: http://localhost:8080

#### 2. Build Production Binary

```bash
docker-compose exec backend go build -o main .
```

#### 3. Testing

```bash
docker-compose exec backend go test ./...
```

#### 4. Backend Structure (to expand)

```
backend/
├── main.go               # Entry point
├── handlers/             # HTTP handlers (create as needed)
├── models/               # Data models (create as needed)
├── services/             # Business logic (create as needed)
├── middleware/           # Custom middleware (create as needed)
├── config/               # Configuration (create as needed)
├── go.mod
├── go.sum
└── Dockerfile
```

#### 5. Adding Dependencies

```bash
docker-compose exec backend go get github.com/user/package
```

### Database Development

#### 1. Connect to Database

```bash
make db-connect
# or
docker-compose exec db mysql -u transcendence -p transcendence
```

Password: `transcendence_pass`

#### 2. Run SQL Queries

```bash
docker-compose exec db mysql -u transcendence -p transcendence -e "SELECT * FROM users;"
```

#### 3. Create Migration

Add new SQL to `db/init.sql` and restart:

```bash
docker-compose down
docker-compose up -d
```

#### 4. Export Database

```bash
docker-compose exec db mysqldump -u transcendence -p transcendence > backup.sql
```

#### 5. Import Database

```bash
docker-compose exec -T db mysql -u transcendence -p transcendence < backup.sql
```

## Common Tasks

### View Logs

```bash
# All services
make logs

# Specific service
make logs-backend
make logs-frontend
make logs-db

# Follow logs
docker-compose logs -f backend --tail 100
```

### Access Container Shell

```bash
make shell-backend
make shell-frontend
make shell-db
```

### Restart Services

```bash
make restart

# or specific service
docker-compose restart backend
```

### Clean Up

```bash
# Stop containers
make down

# Stop and remove volumes (data loss)
make clean

# Remove images only
docker-compose rmi
```

### Health Check

```bash
make health-check

# Manual check
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/status
```

## Testing the API

### Using curl

```bash
# Check health
curl -X GET http://localhost:8080/health

# Get status
curl -X GET http://localhost:8080/api/v1/status
```

### Using Postman/Insomnia

1. Import the API endpoints from `API_DOCUMENTATION.md`
2. Set base URL: `http://localhost:8080`
3. Test endpoints

### Using Frontend

Visit http://localhost:3000 and interact with the UI (to be built).

## Debugging

### Backend Issues

1. **Port already in use:**
   ```bash
   lsof -i :8080
   kill -9 <PID>
   ```

2. **Database connection failed:**
   ```bash
   docker-compose logs db
   make db-connect
   ```

3. **Hot reload not working:**
   ```bash
   docker-compose down
   docker-compose up -d --build backend
   ```

### Frontend Issues

1. **Port already in use:**
   ```bash
   lsof -i :3000
   kill -9 <PID>
   ```

2. **Module not found:**
   ```bash
   docker-compose exec frontend rm -rf node_modules
   docker-compose exec frontend npm install
   ```

3. **Build fails:**
   ```bash
   docker-compose exec frontend npm run build
   # Check error output
   ```

### Database Issues

1. **Connection refused:**
   ```bash
   docker-compose logs db
   docker-compose ps
   ```

2. **Data not persisted:**
   - Check volume with: `docker volume ls`
   - Verify volume mount in `docker-compose.yml`

## Performance Optimization

### Frontend
- Enable code splitting in Next.js
- Optimize images with Next.js Image component
- Use React.memo for expensive components
- Monitor with Chrome DevTools

### Backend
- Add database connection pooling
- Implement caching (Redis)
- Use profiling: `go tool pprof`
- Monitor with Prometheus

### Database
- Add appropriate indexes
- Optimize queries
- Monitor with MySQL Workbench

## Production Checklist

Before deploying to production:

- [ ] Remove debug logging
- [ ] Set environment variables
- [ ] Enable HTTPS
- [ ] Configure CORS properly
- [ ] Set up database backups
- [ ] Enable authentication
- [ ] Implement rate limiting
- [ ] Add monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Performance testing
- [ ] Security audit

## Next Steps

1. Implement user authentication
2. Add API endpoints for core features
3. Build frontend pages and components
4. Add real-time features with WebSockets
5. Implement file upload system
6. Add testing suite
7. Set up CI/CD pipeline
8. Configure production deployment

## Useful Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Echo Web Framework](https://echo.labstack.com/)
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [Docker Documentation](https://docs.docker.com/)
- [42 School Resources](https://42.fr/)

## Support

For issues or questions:
1. Check logs: `make logs`
2. Review this guide
3. Check README.md
4. Consult API_DOCUMENTATION.md
5. Review DOCKER_GUIDE.md
