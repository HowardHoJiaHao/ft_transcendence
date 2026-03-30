#!/bin/bash

# Transcendence Marketplace - Quick Setup Script

set -e

echo "🚀 Transcendence Marketplace Setup"
echo "=================================="

# Check Docker installation
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi

echo "✅ Docker found"
echo "✅ Docker Compose found"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ .env created (update it with your configuration)"
fi

# Build images
echo "🔨 Building Docker images..."
docker-compose build

# Start services
echo "🚀 Starting services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check health
echo "🏥 Checking service health..."

if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ Backend API is healthy"
else
    echo "⚠️  Backend API not yet ready (check logs with: docker-compose logs -f backend)"
fi

# Display service URLs
echo ""
echo "✨ Services are running:"
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:8080"
echo "  Database:  localhost:3306"
echo ""
echo "📖 View logs with:     docker-compose logs -f"
echo "🛑 Stop services with: docker-compose down"
echo "📚 More info in:       README.md"
