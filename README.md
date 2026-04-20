# dnd-campaign-tracker

A comprehensive D&D campaign management system with:

## Features

### Campaign Management (Admin)
- **Multiple Maps**: Upload and manage multiple campaign maps
- **Map Events**: Add markers for events and quests on the default map
- **Points of Interest**: Place markers on uploaded maps (cities, dungeons, landmarks)
- **Campaign Diary**: Shared diary entries for session notes

### Character Management (Players)
- **Character Creation**: Create and manage your characters
- **Character Sheets**: Upload PDF/image character sheets
- **Character Details**: Track name, class, level, race, and notes
- **Personal Inventory**: Manage character-specific items
- **Character Diary**: Personal notes and session logs per character

### Shared Resources
- **Party Resources**: Track shared party items and quantities
- **Bestiary**: Collaborative creature database with stats, weaknesses, and abilities
- **Allies/NPCs**: Track friendly NPCs, their roles, and relationships

### User System
- **Admin users**: Full control over maps, events, diary, and all content
- **Player users**: Can create characters, manage inventories, add bestiary entries, and contribute to party resources

### Technical Stack
- **Backend**: FastAPI with SQLAlchemy ORM
- **Frontend**: React with Vite
- **Database**: SQLite with file upload support
- **Authentication**: JWT tokens with bcrypt password hashing

## Backend (FastAPI)

### Quick Start with Docker (Recommended)

The easiest way to run the backend is with Docker:

```bash
cd backend
./deploy.sh
```

This will automatically:
- Create a `.env` file with a generated secret key
- Build the Docker image
- Start the backend with persistent database and uploads

Then create an admin user:
```bash
docker-compose exec backend python create_admin.py
```

**API URLs:**
- API: http://localhost:8000
- API Docs: http://localhost:8000/docs

See [backend/DEPLOYMENT.md](backend/DEPLOYMENT.md) for detailed deployment instructions including Render, Railway, Fly.io, and more.

### Manual Setup (Development)

#### Unix/Mac
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

#### Windows (Git Bash)
```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

#### Windows (PowerShell)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API base URL: `http://localhost:8000`

## Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Frontend URL: `http://localhost:5173`

By default the frontend calls `http://localhost:8000`. To change it:

```bash
VITE_API_URL="http://localhost:8000" npm run dev
```

## GitHub Pages Deployment

The frontend can be deployed to GitHub Pages at:

`https://karshkin.github.io/dnd-campaing-tracker/`

The deployment workflow (`.github/workflows/deploy.yml`) automatically builds the React + Vite frontend from `frontend/` and publishes to GitHub Pages.

> **Backend Deployment**: The FastAPI backend needs to be deployed separately. See [backend/DEPLOYMENT.md](backend/DEPLOYMENT.md) for instructions on deploying to Render, Railway, Fly.io, or any platform with Docker support. Once deployed, configure `VITE_API_URL` in your GitHub Actions workflow to point to your backend.

### Enabling GitHub Pages

To enable GitHub Pages for your repository:

1. **Merge this branch to `main`** - The workflow only runs on pushes to the `main` branch
2. **Enable GitHub Pages**:
   - Go to your repository **Settings** → **Pages**
   - Under **Build and deployment**, set **Source** to **Deploy from a branch**
   - Select branch **`gh-pages`** and folder **`/ (root)`**
   - Click **Save**
3. **Wait for deployment** - After merging to `main`, GitHub Actions will automatically:
   - Build the frontend
   - Create/update the `gh-pages` branch
   - Deploy to GitHub Pages
4. **Access your app** - Visit `https://karshkin.github.io/dnd-campaing-tracker/` to see your deployed app

The deployment will automatically update whenever you push changes to the `main` branch.

## Authentication Setup

The application supports two types of users:
- **Admin users**: Can manage maps, map events, diary entries, and all resources (accessible via secret URL)
- **Regular users**: Can view content, manage party resources, and create characters

### Admin Access

The admin panel is accessible via a secret URL route: **`http://localhost:5173/#admin`**

Only users with admin privileges can access this panel. There is no visible button to prevent unauthorized discovery. If not logged in, navigating to this URL shows a login prompt.

### Creating the First Admin User

Before using the application, create an admin user:

#### Option 1: Using the create_admin.py script (Recommended)

**With Docker:**
```bash
docker-compose exec backend python create_admin.py
```

**Without Docker (Unix/Mac):**
```bash
cd backend
source .venv/bin/activate
python create_admin.py
```

**Without Docker (Windows Git Bash):**
```bash
cd backend
source .venv/Scripts/activate
python create_admin.py
```

**Without Docker (Windows PowerShell):**
```powershell
cd backend
.venv\Scripts\Activate.ps1
python create_admin.py
```

### Option 2: Using curl (Unix/Mac/Git Bash)
```bash
curl -X POST http://localhost:8000/init-admin \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-secure-password"}'
```

### Option 3: Using PowerShell
```powershell
Invoke-RestMethod -Uri http://localhost:8000/init-admin -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"username":"admin","password":"your-secure-password"}'
```

### Option 4: Using Python
```bash
# In backend directory with venv activated
python -c "import requests; requests.post('http://localhost:8000/init-admin', json={'username':'admin','password':'your-secure-password'})"
```

**Important:** This endpoint only works when no users exist in the database. Change the default password after first login.

Once created, you can login using the "Login" button in the frontend.

### Registering Regular Users

Players can register their own accounts using the "Register" button in the frontend. Regular users can:
- View all content across the application
- Add and update party resources
- Create and manage their own characters
- Upload character sheets
- Manage character inventory and diary
- Add creatures to the bestiary
- Add allies/NPCs to the campaign

**Note**: Regular users cannot access the admin panel at `#admin` even if they know the URL.

## Frontend Routes

The frontend uses hash-based routing:

- `/#/tracker` (or `/`) - Main campaign chronicle view (public)
- `/#/characters` - Character management (requires login)
- `/#/bestiary` - Bestiary view (public, authenticated users can add)
- `/#/allies` - Allies & NPCs view (public, authenticated users can add)
- `/#/login` - Login page
- `/#/register` - Registration page
- `#admin` - **Admin panel** (requires admin privileges) - Secret URL for DM/admin only

## API Endpoints

The API is automatically documented at `http://localhost:8000/docs` (Swagger UI) when the server is running.

### Authentication
- `POST /login` - Login with username/password
- `POST /register` - Register a new user
- `POST /init-admin` - Create first admin user (one-time)
- `GET /me` - Get current user info

### Characters (Authenticated Users)
- `GET /characters` - List user's characters
- `POST /characters` - Create character
- `PUT /characters/{id}` - Update character
- `POST /characters/{id}/upload-sheet` - Upload character sheet file
- `DELETE /characters/{id}` - Delete character
- `GET /characters/{id}/inventory` - List character inventory
- `POST /characters/{id}/inventory` - Add inventory item
- `DELETE /inventory/{id}` - Delete inventory item
- `GET /characters/{id}/diary` - List character diary entries
- `POST /characters/{id}/diary` - Add diary entry

### Maps (Admin for Create/Delete, All for Read)
- `GET /maps` - List all maps
- `POST /maps` - Upload new map (admin only)
- `DELETE /maps/{id}` - Delete map (admin only)
- `GET /maps/{id}/pois` - List points of interest on a map
- `POST /pois` - Create point of interest (admin only)
- `DELETE /pois/{id}` - Delete point of interest (admin only)

### Resources (Authenticated Users)
- `GET /resources` - List party resources
- `POST /resources` - Add party resource
- `PUT /resources/{id}` - Update party resource

### Bestiary & Allies (Authenticated Users)
- `GET /creatures` - List all creatures
- `POST /creatures` - Add creature
- `DELETE /creatures/{id}` - Delete creature (own or admin)
- `GET /allies` - List all allies
- `POST /allies` - Add ally
- `DELETE /allies/{id}` - Delete ally (own or admin)

### Campaign Diary & Events (Admin Only for Create/Update/Delete)
- `GET /events` - List map events
- `POST /events` - Create event (admin)
- `PUT /events/{id}` - Update event (admin)
- `DELETE /events/{id}` - Delete event (admin)
- `GET /diary` - List campaign diary entries
- `POST /diary` - Add diary entry (admin)

## Tests

### Unix/Mac
```bash
cd backend
source .venv/bin/activate
python -m pytest
```

### Windows (Git Bash)
```bash
cd backend
source .venv/Scripts/activate
python -m pytest
```

### Windows (PowerShell)
```powershell
cd backend
.venv\Scripts\Activate.ps1
python -m pytest
```

## Troubleshooting

### Python 3.14 Compatibility
If you're using Python 3.14, you may encounter build issues with `pydantic-core`. The requirements have been updated to use newer versions (`pydantic>=2.12.0`) which should resolve this. If issues persist, consider using Python 3.11 or 3.12 for better compatibility.
