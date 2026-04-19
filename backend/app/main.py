import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import SessionLocal, engine
from .models import Base, DiaryEntry, MapEvent, Resource
from .schemas import (
    DiaryEntryCreate,
    DiaryEntryRead,
    MapEventCreate,
    MapEventRead,
    MapEventUpdate,
    ResourceCreate,
    ResourceRead,
    ResourceUpdate,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="DnD Campaign Tracker API")

raw_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [origin.strip() for origin in raw_allowed_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.get("/events", response_model=list[MapEventRead])
def list_events(db: Session = Depends(get_db)):
    return db.query(MapEvent).order_by(MapEvent.created_at.desc()).all()


@app.post("/events", response_model=MapEventRead, status_code=201)
def create_event(payload: MapEventCreate, db: Session = Depends(get_db)):
    event = MapEvent(**payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@app.put("/events/{event_id}", response_model=MapEventRead)
def update_event(event_id: int, payload: MapEventUpdate, db: Session = Depends(get_db)):
    event = db.get(MapEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    for field, value in payload.model_dump().items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)
    return event


@app.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.get(MapEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    db.delete(event)
    db.commit()


@app.get("/diary", response_model=list[DiaryEntryRead])
def list_diary_entries(db: Session = Depends(get_db)):
    return db.query(DiaryEntry).order_by(DiaryEntry.created_at.desc()).all()


@app.post("/diary", response_model=DiaryEntryRead, status_code=201)
def create_diary_entry(payload: DiaryEntryCreate, db: Session = Depends(get_db)):
    entry = DiaryEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.get("/resources", response_model=list[ResourceRead])
def list_resources(db: Session = Depends(get_db)):
    return db.query(Resource).order_by(Resource.name.asc()).all()


@app.post("/resources", response_model=ResourceRead, status_code=201)
def create_resource(payload: ResourceCreate, db: Session = Depends(get_db)):
    existing = db.query(Resource).filter(Resource.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Resource already exists")

    resource = Resource(**payload.model_dump())
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


@app.put("/resources/{resource_id}", response_model=ResourceRead)
def update_resource(resource_id: int, payload: ResourceUpdate, db: Session = Depends(get_db)):
    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    existing = db.query(Resource).filter(Resource.name == payload.name, Resource.id != resource_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Resource already exists")

    for field, value in payload.model_dump().items():
        setattr(resource, field, value)

    db.commit()
    db.refresh(resource)
    return resource
