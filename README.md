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

## Aplicación serverless

El frontend React y Vite se publica en [GitHub Pages](https://karshkin.github.io/dnd-campaing-tracker/).
Supabase Auth gestiona las sesiones, PostgreSQL aplica los permisos y Storage guarda los archivos
en un bucket privado. El correo identifica la cuenta y el nombre de usuario sigue siendo visible
en la aplicación. El panel de administración está en `/#/admin` dentro de la base de GitHub Pages.

Consulta la [guía de migración y despliegue](supabase/README.md) para preparar Supabase,
trasladar una campaña de SQLite, crear el primer administrador y validar el cambio.

### Desarrollo del frontend

```sh
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

Configura en `.env.local` la URL y la clave publicable del proyecto. Para usar un proyecto
Supabase local, consulta la guía de validación. La URL que muestra Vite incluye la base
`/dnd-campaing-tracker/`.

## Backend anterior (FastAPI y SQLite)

### Unix/Mac
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Windows (Git Bash)
```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Windows (PowerShell)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m app.migrations
uvicorn app.main:app --reload
```

API base URL: `http://localhost:8000`

### Database migrations

Run SQL migrations manually from `backend/`:

```bash
python -m app.migrations
```

The API startup also runs pending migrations automatically before serving requests.

To add a new migration, create the next zero-padded SQL file in `backend/migrations/`, for example `015_some_change.sql`. Migrations run in filename order and each file is recorded once in `schema_migrations`, so keep each file focused on a single schema change.

## Pruebas de FastAPI

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
