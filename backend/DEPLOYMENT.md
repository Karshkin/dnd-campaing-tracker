# Backend Deployment Guide

This guide covers deploying the DnD Campaign Tracker backend with Docker.

## Prerequisites

- Docker installed on your system
- Docker Compose (optional, for easier management)

## Quick Start with Docker Compose

1. **Generate a secret key:**
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

2. **Create a `.env` file in the backend directory:**
   ```env
   SECRET_KEY=your-generated-secret-key-here
   ACCESS_TOKEN_EXPIRE_MINUTES=480
   ALLOWED_ORIGINS=https://your-frontend-domain.com,https://karshkin.github.io
   DATABASE_URL=sqlite:///./data/campaign.db
   ```

3. **Create required directories:**
   ```bash
   mkdir -p data uploads
   ```

4. **Start the backend:**
   ```bash
   docker-compose up -d
   ```

5. **Create an admin user:**
   ```bash
   docker-compose exec backend python create_admin.py
   ```

6. **Access the API:**
   - API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

## Manual Docker Deployment

If you prefer not to use Docker Compose:

1. **Build the Docker image:**
   ```bash
   docker build -t dnd-backend .
   ```

2. **Create volumes for persistence:**
   ```bash
   docker volume create dnd-data
   docker volume create dnd-uploads
   ```

3. **Run the container:**
   ```bash
   docker run -d \
     --name dnd-backend \
     -p 8000:8000 \
     -v dnd-data:/app/data \
     -v dnd-uploads:/app/uploads \
     -e SECRET_KEY="your-secret-key" \
     -e ALLOWED_ORIGINS="https://your-frontend-domain.com" \
     --restart unless-stopped \
     dnd-backend
   ```

4. **Create an admin user:**
   ```bash
   docker exec -it dnd-backend python create_admin.py
   ```

## Deployment Platforms

### Render.com

1. Create a new Web Service
2. Connect your GitHub repository
3. Configure:
   - **Root Directory:** `backend`
   - **Runtime:** Docker
   - **Add Disk:** Mount path `/app/data` for database persistence
4. Add environment variables in Render dashboard:
   - `SECRET_KEY`
   - `ALLOWED_ORIGINS`
5. Deploy!

### Railway.app

1. Create new project from GitHub repo
2. Add a service for the backend
3. Configure:
   - **Root Directory:** `backend`
   - **Dockerfile Path:** `backend/Dockerfile`
4. Add a volume at `/app/data` for database
5. Set environment variables
6. Deploy!

### Fly.io

1. Install flyctl CLI
2. Create `fly.toml` in backend directory:
   ```toml
   app = "your-app-name"
   
   [build]
     dockerfile = "Dockerfile"
   
   [env]
     PORT = "8000"
   
   [[services]]
     internal_port = 8000
     protocol = "tcp"
   
     [[services.ports]]
       handlers = ["http"]
       port = 80
   
     [[services.ports]]
       handlers = ["tls", "http"]
       port = 443
   
   [mounts]
     source = "data"
     destination = "/app/data"
   ```

3. Deploy:
   ```bash
   fly launch
   fly secrets set SECRET_KEY="your-secret-key"
   fly secrets set ALLOWED_ORIGINS="https://your-frontend.com"
   fly deploy
   ```

### DigitalOcean / AWS / Any VPS

1. SSH into your server
2. Install Docker and Docker Compose
3. Clone your repository or copy the backend folder
4. Follow the "Quick Start with Docker Compose" steps above
5. Configure your reverse proxy (nginx/caddy) to point to port 8000
6. Set up SSL with Let's Encrypt

## Production Considerations

### Security
- Always use a strong, randomly generated `SECRET_KEY`
- Set `ALLOWED_ORIGINS` to only your frontend domain(s)
- Use HTTPS in production
- Keep dependencies updated

### Database Backups
Your SQLite database is in the `data` directory (or Docker volume). To backup:
```bash
# With Docker Compose
docker-compose exec backend cp /app/data/campaign.db /app/data/campaign.db.backup

# Copy backup to host
docker cp dnd-backend:/app/data/campaign.db.backup ./backup-$(date +%Y%m%d).db
```

### Monitoring
Add health check endpoint access to your monitoring tools:
- Health endpoint: `GET /health`
- API docs: `GET /docs`

### Scaling
For production with more users:
- Consider using PostgreSQL instead of SQLite
- Add a reverse proxy (nginx/Caddy) for load balancing
- Use a CDN for static files
- Implement proper logging and monitoring

## Updating

To update your deployment:

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Troubleshooting

### Check logs
```bash
docker-compose logs -f backend
```

### Access container shell
```bash
docker-compose exec backend /bin/bash
```

### Database issues
```bash
# Verify database exists
docker-compose exec backend ls -la /app/data/

# Run migrations manually if needed
docker-compose exec backend python -c "from app.database import engine; from app.models import Base; Base.metadata.create_all(bind=engine)"
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | Yes | - | JWT secret key (generate with `secrets.token_hex(32)`) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | 480 | Token expiration time in minutes |
| `ALLOWED_ORIGINS` | Yes | - | Comma-separated list of allowed CORS origins |
| `DATABASE_URL` | No | `sqlite:///./data/campaign.db` | Database connection string |
