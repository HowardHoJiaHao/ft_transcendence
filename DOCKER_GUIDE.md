# Docker Development Guide

## Building Docker Images

To build all services:

```bash
docker-compose build
```

To build a specific service:

```bash
docker-compose build backend
docker-compose build frontend
docker-compose build db
```

## Running Services

### Start all services
```bash
docker-compose up
```

### Start in background
```bash
docker-compose up -d
```

### Start specific service
```bash
docker-compose up backend
```

## Debugging

### Check container status
```bash
docker-compose ps
```

### View logs
```bash
docker-compose logs -f
docker-compose logs -f backend --tail 100
```

### Execute commands in container
```bash
docker-compose exec backend go run main.go
docker-compose exec frontend npm run build
docker-compose exec db mysql -u transcendence -p
```

### Access container shell
```bash
docker-compose exec backend sh
docker-compose exec frontend sh
docker-compose exec db bash
```

## Performance Optimization

### Production Dockerfile Frontend

Use multi-stage builds in `frontend/Dockerfile` for production:

```dockerfile
FROM node:18-alpine as deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "start"]
```

### Production Dockerfile Backend

Optimize Go binary size:

```dockerfile
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o main .
```

## Networking

Services communicate using service names:
- `db` - MySQL database
- `backend` - Go API server
- `frontend` - Next.js application

These are automatically resolved by Docker's internal DNS.

## Volume Management

### Clean up unused volumes
```bash
docker volume prune
```

### List volumes
```bash
docker volume ls
```

### Inspect volume
```bash
docker volume inspect trans_mysql_data
```

## Advanced Topics

### Custom Network

Services use a custom bridge network `transcendence-network` for isolation.

### Health Checks

MySQL has a health check that ensures the database is ready before backend starts:

```yaml
healthcheck:
  test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
  timeout: 20s
  retries: 10
  interval: 10s
```

### Resource Limits

To add resource limits, update `docker-compose.yml`:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

## CI/CD Integration

For GitHub Actions, create `.github/workflows/docker.yml`:

```yaml
name: Build Docker Images

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/setup-buildx-action@v2
      - uses: docker/build-push-action@v4
        with:
          context: ./backend
          push: false
```
