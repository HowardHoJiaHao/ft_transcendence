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

# -s means silent. hide progress bar and error messages. 
# > /dev/null; then is removing every output because we dont care about it. we only care it succeed or not
if curl -s http://localhost:8080/health > /dev/null; then #if it is 0. if (condition) means if condition return 0 in bash. then execute this
    echo "✅ Backend API is healthy"
else # if it return 1
    echo "⚠️  Backend API not yet ready (check logs with: docker-compose logs -f backend)"
fi #end if

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
