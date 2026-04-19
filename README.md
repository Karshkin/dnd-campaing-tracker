# dnd-campaing-tracker

A minimal full-stack campaign tracker with:
- **Python API** for map events, diary entries, and resources
- **React tracker webpage** to visualize map markers and campaign data
- **React backoffice** to manage map events (including click-to-place markers), resources, and diary entries
- **SQLite database** for persistence

## Backend (FastAPI)

```bash
cd /home/runner/work/dnd-campaing-tracker/dnd-campaing-tracker/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API base URL: `http://localhost:8000`

## Frontend (React + Vite)

```bash
cd /home/runner/work/dnd-campaing-tracker/dnd-campaing-tracker/frontend
npm install
npm run dev
```

Frontend URL: `http://localhost:5173`

By default the frontend calls `http://localhost:8000`. To change it:

```bash
VITE_API_URL="http://localhost:8000" npm run dev
```

## Tests

```bash
cd /home/runner/work/dnd-campaing-tracker/dnd-campaing-tracker/backend
python -m pytest
```
