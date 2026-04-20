#!/bin/bash

# Quick deployment script for DnD Campaign Tracker Backend

set -e

echo "🚀 DnD Campaign Tracker Backend - Quick Deploy"
echo "=============================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Error: Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 No .env file found. Creating from .env.docker..."
    cp .env.docker .env
    
    # Generate a random secret key
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || openssl rand -hex 32)
    
    # Replace the secret key in .env file
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/your-secret-key-here-change-this-in-production/$SECRET_KEY/" .env
    else
        sed -i "s/your-secret-key-here-change-this-in-production/$SECRET_KEY/" .env
    fi
    
    echo "✅ Created .env file with generated SECRET_KEY"
    echo "⚠️  IMPORTANT: Edit .env and set ALLOWED_ORIGINS to your frontend domain!"
    echo ""
    read -p "Press Enter to continue after updating ALLOWED_ORIGINS in .env..."
fi

# Create data and uploads directories
echo "📁 Creating directories for persistent data..."
mkdir -p data uploads
echo "✅ Directories created"
echo ""

# Build and start the containers
echo "🔨 Building Docker image..."
docker-compose build

echo ""
echo "🚀 Starting backend service..."
docker-compose up -d

echo ""
echo "⏳ Waiting for backend to be ready..."
sleep 5

# Check if the service is running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Backend is running!"
    echo ""
    echo "📋 Next steps:"
    echo "  1. Create an admin user: docker-compose exec backend python create_admin.py"
    echo "  2. Access API docs: http://localhost:8000/docs"
    echo "  3. View logs: docker-compose logs -f backend"
    echo ""
    echo "🎉 Deployment complete!"
else
    echo "❌ Backend failed to start. Check logs with: docker-compose logs backend"
    exit 1
fi
