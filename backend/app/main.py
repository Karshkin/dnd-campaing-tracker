import os
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    authenticate_user,
    create_access_token,
    get_current_active_user,
    get_current_admin_user,
    get_password_hash,
    require_page_permission,
)
from .database import SessionLocal, engine
from .file_handler import CHARACTER_SHEETS_DIR, MAPS_DIR, MARKER_IMAGES_DIR, delete_file, save_upload_file
from .models import (
    Ally,
    Base,
    Character,
    CharacterDiary,
    CharacterInventory,
    Creature,
    DiaryEntry,
    Map,
    MapEvent,
    Organization,
    PAGE_KEYS,
    PointOfInterest,
    PagePermission,
    Resource,
    User,
)
from .schemas import (
    AdminPasswordReset,
    AdminUserCreate,
    AllyCreate,
    AllyRead,
    CharacterCreate,
    CharacterDiaryCreate,
    CharacterDiaryRead,
    CharacterInventoryCreate,
    CharacterInventoryRead,
    CharacterRead,
    CharacterUpdate,
    CurrentUserRead,
    CreatureCreate,
    CreatureRead,
    DiaryEntryCreate,
    DiaryEntryRead,
    MapEventCreate,
    MapEventRead,
    MapEventUpdate,
    MapRead,
    OrganizationCreate,
    OrganizationRead,
    PagePermissionRead,
    PagePermissionUpdate,
    PointOfInterestCreate,
    PointOfInterestRead,
    PointOfInterestUpdate,
    ResourceCreate,
    ResourceRead,
    ResourceUpdate,
    Token,
    UserLogin,
    UserRead,
    UserRegister,
    UserWithPermissionsRead,
)

Base.metadata.create_all(bind=engine)

# Run lightweight migration for existing databases
import sqlite3 as _sqlite3
try:
    _conn = _sqlite3.connect("campaign.db")
    _conn.execute("ALTER TABLE map_events ADD COLUMN map_id INTEGER REFERENCES maps(id)")
    _conn.commit()
    _conn.close()
except Exception:
    pass  # Column already exists

try:
    _conn = _sqlite3.connect("campaign.db")
    for _sql in [
        "ALTER TABLE map_events ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE points_of_interest ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE resources ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE diary_entries ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE creatures ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE allies ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE allies ADD COLUMN organization_id INTEGER REFERENCES organizations(id)",
        "ALTER TABLE allies ADD COLUMN alignment VARCHAR(20) DEFAULT 'neutral'",
        "ALTER TABLE characters ADD COLUMN image_path VARCHAR(255)",
        "ALTER TABLE characters ADD COLUMN organization_id INTEGER REFERENCES organizations(id)",
    ]:
        try:
            _conn.execute(_sql)
        except Exception:
            pass  # column already exists
    _conn.commit()
    _conn.close()
except Exception:
    pass

try:
    _conn = _sqlite3.connect("campaign.db")
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(120) NOT NULL,
            description TEXT DEFAULT '',
            image_path VARCHAR(255),
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    _conn.commit()
    _conn.close()
except Exception:
    pass

try:
    _conn = _sqlite3.connect("campaign.db")
    _conn.execute(
        """
        CREATE TABLE IF NOT EXISTS page_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            page_key VARCHAR(50) NOT NULL,
            permission_level VARCHAR(20) NOT NULL DEFAULT 'none',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_page_permissions_user_page UNIQUE (user_id, page_key),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    _conn.commit()
    _conn.close()
except Exception:
    pass

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

# Mount uploads directory for serving files
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

DEFAULT_SELF_REGISTER_PERMISSIONS = {
    "tracker": "view",
    "characters": "edit",
    "bestiary": "view",
    "organizations": "view",
    "npcs": "view",
    "admin": "none",
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def assign_page_permissions(db: Session, user_id: int, permissions: dict[str, str]) -> None:
    for page_key, permission_level in permissions.items():
        db.add(PagePermission(user_id=user_id, page_key=page_key, permission_level=permission_level))


def ensure_user_permissions(db: Session, user: User) -> list[PagePermission]:
    existing = {
        permission.page_key: permission
        for permission in db.query(PagePermission).filter(PagePermission.user_id == user.id).all()
    }
    changed = False

    for page_key in PAGE_KEYS:
        if page_key not in existing:
            default_level = "admin" if user.is_admin and page_key == "admin" else DEFAULT_SELF_REGISTER_PERMISSIONS.get(page_key, "none")
            permission = PagePermission(user_id=user.id, page_key=page_key, permission_level=default_level)
            db.add(permission)
            existing[page_key] = permission
            changed = True

    if changed:
        db.commit()

    return [existing[page_key] for page_key in PAGE_KEYS]


def serialize_user_with_permissions(db: Session, user: User) -> dict:
    permissions = ensure_user_permissions(db, user)
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": user.is_admin,
        "created_at": user.created_at,
        "permissions": permissions,
    }


TrackerViewUser = Annotated[User, Depends(require_page_permission("tracker", "view"))]
TrackerEditUser = Annotated[User, Depends(require_page_permission("tracker", "edit"))]
CharactersViewUser = Annotated[User, Depends(require_page_permission("characters", "view"))]
CharactersEditUser = Annotated[User, Depends(require_page_permission("characters", "edit"))]
BestiaryViewUser = Annotated[User, Depends(require_page_permission("bestiary", "view"))]
BestiaryEditUser = Annotated[User, Depends(require_page_permission("bestiary", "edit"))]
OrganizationsViewUser = Annotated[User, Depends(require_page_permission("organizations", "view"))]
OrganizationsEditUser = Annotated[User, Depends(require_page_permission("organizations", "edit"))]
NpcsViewUser = Annotated[User, Depends(require_page_permission("npcs", "view"))]
NpcsEditUser = Annotated[User, Depends(require_page_permission("npcs", "edit"))]
AdminPageUser = Annotated[User, Depends(require_page_permission("admin", "admin"))]


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.post("/login", response_model=Token)
def login(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_db)):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "is_admin": user.is_admin}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/register", response_model=UserRead, status_code=201)
def register(payload: UserRegister, db: Session = Depends(get_db)):
    """Register a new regular user (non-admin)."""
    existing_user = db.query(User).filter(User.username == payload.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    new_user = User(
        username=payload.username,
        hashed_password=get_password_hash(payload.password),
        is_admin=False,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    assign_page_permissions(db, new_user.id, DEFAULT_SELF_REGISTER_PERMISSIONS)
    db.commit()
    return new_user


@app.get("/me", response_model=CurrentUserRead)
def get_current_user_info(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Get current authenticated user information."""
    return serialize_user_with_permissions(db, current_user)


@app.post("/init-admin", status_code=201)
def initialize_admin(payload: UserLogin, db: Session = Depends(get_db)):
    """Create the first admin user. Only works if no users exist."""
    existing_users = db.query(User).count()
    if existing_users > 0:
        raise HTTPException(status_code=400, detail="Admin user already exists")

    admin = User(
        username=payload.username,
        hashed_password=get_password_hash(payload.password),
        is_admin=True,
    )
    db.add(admin)
    db.commit()
    return {"message": "Admin user created successfully"}


@app.get("/events", response_model=list[MapEventRead])
def list_events(map_id: int | None = None, current_user: TrackerViewUser = None, db: Session = Depends(get_db)):
    query = db.query(MapEvent)
    if map_id is not None:
        query = query.filter(MapEvent.map_id == map_id)
    return query.order_by(MapEvent.created_at.desc()).all()


@app.post("/events", response_model=MapEventRead, status_code=201)
def create_event(
    payload: MapEventCreate,
    db: Session = Depends(get_db),
    current_user: TrackerEditUser = None,
):
    event = MapEvent(**payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@app.put("/events/{event_id}", response_model=MapEventRead)
def update_event(
    event_id: int,
    payload: MapEventUpdate,
    db: Session = Depends(get_db),
    current_user: TrackerEditUser = None,
):
    event = db.get(MapEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    for field, value in payload.model_dump().items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)
    return event


@app.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db), current_user: TrackerEditUser = None):
    event = db.get(MapEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    db.delete(event)
    db.commit()


@app.get("/diary", response_model=list[DiaryEntryRead])
def list_diary_entries(current_user: TrackerViewUser = None, db: Session = Depends(get_db)):
    return db.query(DiaryEntry).order_by(DiaryEntry.created_at.desc()).all()


@app.post("/diary", response_model=DiaryEntryRead, status_code=201)
def create_diary_entry(
    payload: DiaryEntryCreate,
    db: Session = Depends(get_db),
    current_user: TrackerEditUser = None,
):
    entry = DiaryEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.delete("/diary/{entry_id}", status_code=204)
def delete_diary_entry(
    entry_id: int,
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    entry = db.get(DiaryEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Diary entry not found")
    db.delete(entry)
    db.commit()


@app.get("/resources", response_model=list[ResourceRead])
def list_resources(current_user: TrackerViewUser = None, db: Session = Depends(get_db)):
    return db.query(Resource).order_by(Resource.name.asc()).all()


@app.post("/resources", response_model=ResourceRead, status_code=201)
def create_resource(
    payload: ResourceCreate,
    db: Session = Depends(get_db),
    current_user: TrackerEditUser = None,
):
    existing = db.query(Resource).filter(Resource.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Resource already exists")

    resource = Resource(**payload.model_dump())
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


@app.put("/resources/{resource_id}", response_model=ResourceRead)
def update_resource(
    resource_id: int,
    payload: ResourceUpdate,
    db: Session = Depends(get_db),
    current_user: TrackerEditUser = None,
):
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


@app.delete("/resources/{resource_id}", status_code=204)
def delete_resource(
    resource_id: int,
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    db.delete(resource)
    db.commit()


@app.post("/resources/{resource_id}/image", response_model=ResourceRead)
async def upload_resource_image(
    resource_id: int,
    file: UploadFile = File(...),
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    if resource.image_path:
        delete_file(resource.image_path)
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    resource.image_path = file_path
    db.commit()
    db.refresh(resource)
    return resource


# ===== CHARACTER ENDPOINTS =====
@app.get("/characters", response_model=list[CharacterRead])
def list_characters(current_user: CharactersViewUser = None, db: Session = Depends(get_db)):
    """List all characters for the current user."""
    return db.query(Character).filter(Character.user_id == current_user.id).all()


@app.post("/characters", response_model=CharacterRead, status_code=201)
def create_character(
    payload: CharacterCreate,
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Create a new character for the current user."""
    character = Character(**payload.model_dump(), user_id=current_user.id)
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@app.put("/characters/{character_id}", response_model=CharacterRead)
def update_character(
    character_id: int,
    payload: CharacterUpdate,
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Update a character owned by the current user."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    for field, value in payload.model_dump().items():
        setattr(character, field, value)

    db.commit()
    db.refresh(character)
    return character


@app.post("/characters/{character_id}/upload-sheet")
def upload_character_sheet(
    character_id: int,
    file: UploadFile = File(...),
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Upload a character sheet file."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    # Delete old file if exists
    if character.sheet_file_path:
        delete_file(character.sheet_file_path)

    # Save new file
    file_path = save_upload_file(file, CHARACTER_SHEETS_DIR)
    character.sheet_file_path = file_path
    db.commit()

    return {"file_path": file_path}


@app.post("/characters/{character_id}/image", response_model=CharacterRead)
async def upload_character_image(
    character_id: int,
    file: UploadFile = File(...),
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Upload a portrait image for a character."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")
    if character.image_path:
        delete_file(character.image_path)
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    character.image_path = file_path
    db.commit()
    db.refresh(character)
    return character


@app.delete("/characters/{character_id}", status_code=204)
def delete_character(
    character_id: int,
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Delete a character owned by the current user."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    # Delete character sheet file
    if character.sheet_file_path:
        delete_file(character.sheet_file_path)

    db.delete(character)
    db.commit()


# ===== CHARACTER INVENTORY ENDPOINTS =====
@app.get("/characters/{character_id}/inventory", response_model=list[CharacterInventoryRead])
def list_character_inventory(
    character_id: int,
    current_user: CharactersViewUser = None,
    db: Session = Depends(get_db),
):
    """List inventory for a character."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    return db.query(CharacterInventory).filter(CharacterInventory.character_id == character_id).all()


@app.post("/characters/{character_id}/inventory", response_model=CharacterInventoryRead, status_code=201)
def add_inventory_item(
    character_id: int,
    payload: CharacterInventoryCreate,
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Add an item to character inventory."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    item = CharacterInventory(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.delete("/inventory/{item_id}", status_code=204)
def delete_inventory_item(
    item_id: int,
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Delete an inventory item."""
    item = db.get(CharacterInventory, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Verify ownership
    character = db.get(Character, item.character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.commit()


# ===== CHARACTER DIARY ENDPOINTS =====
@app.get("/characters/{character_id}/diary", response_model=list[CharacterDiaryRead])
def list_character_diary(
    character_id: int,
    current_user: CharactersViewUser = None,
    db: Session = Depends(get_db),
):
    """List diary entries for a character."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    return db.query(CharacterDiary).filter(CharacterDiary.character_id == character_id).order_by(CharacterDiary.created_at.desc()).all()


@app.post("/characters/{character_id}/diary", response_model=CharacterDiaryRead, status_code=201)
def add_diary_entry(
    character_id: int,
    payload: CharacterDiaryCreate,
    current_user: CharactersEditUser = None,
    db: Session = Depends(get_db),
):
    """Add a diary entry for a character."""
    character = db.get(Character, character_id)
    if not character or character.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Character not found")

    entry = CharacterDiary(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ===== MAP ENDPOINTS =====
@app.get("/maps", response_model=list[MapRead])
def list_maps(current_user: TrackerViewUser = None, db: Session = Depends(get_db)):
    """List all maps."""
    return db.query(Map).filter(Map.is_active == True).order_by(Map.created_at.desc()).all()


@app.post("/maps", response_model=MapRead, status_code=201)
async def create_map(
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    current_admin: AdminPageUser = None,
    db: Session = Depends(get_db),
):
    """Upload a new map (admin only)."""
    file_path = save_upload_file(file, MAPS_DIR)

    map_obj = Map(name=name, description=description, file_path=file_path)
    db.add(map_obj)
    db.commit()
    db.refresh(map_obj)
    return map_obj


@app.delete("/maps/{map_id}", status_code=204)
def delete_map(
    map_id: int,
    current_admin: AdminPageUser = None,
    db: Session = Depends(get_db),
):
    """Delete a map (admin only)."""
    map_obj = db.get(Map, map_id)
    if not map_obj:
        raise HTTPException(status_code=404, detail="Map not found")

    # Delete map file
    if map_obj.file_path:
        delete_file(map_obj.file_path)

    db.delete(map_obj)
    db.commit()


# ===== POINT OF INTEREST ENDPOINTS =====
@app.get("/maps/{map_id}/pois", response_model=list[PointOfInterestRead])
def list_pois(map_id: int, current_user: TrackerViewUser = None, db: Session = Depends(get_db)):
    """List all points of interest for a map."""
    return db.query(PointOfInterest).filter(PointOfInterest.map_id == map_id).all()


@app.post("/pois", response_model=PointOfInterestRead, status_code=201)
def create_poi(
    payload: PointOfInterestCreate,
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    """Create a point of interest (authenticated users)."""
    poi = PointOfInterest(**payload.model_dump())
    db.add(poi)
    db.commit()
    db.refresh(poi)
    return poi


@app.delete("/pois/{poi_id}", status_code=204)
def delete_poi(
    poi_id: int,
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    """Delete a point of interest (authenticated users)."""
    poi = db.get(PointOfInterest, poi_id)
    if not poi:
        raise HTTPException(status_code=404, detail="POI not found")

    db.delete(poi)
    db.commit()


@app.put("/pois/{poi_id}", response_model=PointOfInterestRead)
def update_poi(
    poi_id: int,
    payload: PointOfInterestUpdate,
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    """Update a point of interest (authenticated users)."""
    poi = db.get(PointOfInterest, poi_id)
    if not poi:
        raise HTTPException(status_code=404, detail="POI not found")

    for field, value in payload.model_dump().items():
        setattr(poi, field, value)

    db.commit()
    db.refresh(poi)
    return poi


@app.post("/pois/{poi_id}/image", response_model=PointOfInterestRead)
async def upload_poi_image(
    poi_id: int,
    file: UploadFile = File(...),
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    """Upload an image for a POI (authenticated users)."""
    poi = db.get(PointOfInterest, poi_id)
    if not poi:
        raise HTTPException(status_code=404, detail="POI not found")
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    poi.image_path = file_path
    db.commit()
    db.refresh(poi)
    return poi


@app.post("/events/{event_id}/image", response_model=MapEventRead)
async def upload_event_image(
    event_id: int,
    file: UploadFile = File(...),
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    """Upload an image for a map event (authenticated users)."""
    event = db.get(MapEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    event.image_path = file_path
    db.commit()
    db.refresh(event)
    return event


# ===== CREATURE ENDPOINTS =====
@app.get("/creatures", response_model=list[CreatureRead])
def list_creatures(current_user: BestiaryViewUser = None, db: Session = Depends(get_db)):
    """List all creatures in the bestiary."""
    return db.query(Creature).order_by(Creature.name.asc()).all()


@app.post("/creatures", response_model=CreatureRead, status_code=201)
def create_creature(
    payload: CreatureCreate,
    current_admin: BestiaryEditUser = None,
    db: Session = Depends(get_db),
):
    """Add a creature to the bestiary (admin only)."""
    creature = Creature(**payload.model_dump(), added_by_user_id=current_admin.id)
    db.add(creature)
    db.commit()
    db.refresh(creature)
    return creature


@app.delete("/creatures/{creature_id}", status_code=204)
def delete_creature(
    creature_id: int,
    current_admin: BestiaryEditUser = None,
    db: Session = Depends(get_db),
):
    """Delete a creature (admin only)."""
    creature = db.get(Creature, creature_id)
    if not creature:
        raise HTTPException(status_code=404, detail="Creature not found")
    db.delete(creature)
    db.commit()


# ===== ALLY ENDPOINTS =====
@app.get("/allies", response_model=list[AllyRead])
def list_allies(current_user: NpcsViewUser = None, db: Session = Depends(get_db)):
    """List all allies/NPCs."""
    return db.query(Ally).order_by(Ally.name.asc()).all()


@app.post("/allies", response_model=AllyRead, status_code=201)
def create_ally(
    payload: AllyCreate,
    current_admin: NpcsEditUser = None,
    db: Session = Depends(get_db),
):
    """Add an ally/NPC (admin only)."""
    ally = Ally(**payload.model_dump(), added_by_user_id=current_admin.id)
    db.add(ally)
    db.commit()
    db.refresh(ally)
    return ally


@app.delete("/allies/{ally_id}", status_code=204)
def delete_ally(
    ally_id: int,
    current_admin: NpcsEditUser = None,
    db: Session = Depends(get_db),
):
    """Delete an ally (admin only)."""
    ally = db.get(Ally, ally_id)
    if not ally:
        raise HTTPException(status_code=404, detail="Ally not found")
    db.delete(ally)
    db.commit()


@app.patch("/allies/{ally_id}/alignment", response_model=AllyRead)
def set_ally_alignment(
    ally_id: int,
    alignment: str,
    current_user: NpcsEditUser = None,
    db: Session = Depends(get_db),
):
    """Set NPC alignment (allied/foe/neutral). Any authenticated user can do this."""
    if alignment not in ("allied", "foe", "neutral"):
        raise HTTPException(status_code=422, detail="alignment must be 'allied', 'foe', or 'neutral'")
    ally = db.get(Ally, ally_id)
    if not ally:
        raise HTTPException(status_code=404, detail="Ally not found")
    ally.alignment = alignment
    db.commit()
    db.refresh(ally)
    return ally


# ===== ORGANIZATION ENDPOINTS =====
@app.get("/organizations", response_model=list[OrganizationRead])
def list_organizations(current_user: OrganizationsViewUser = None, db: Session = Depends(get_db)):
    return db.query(Organization).order_by(Organization.name.asc()).all()


@app.post("/organizations", response_model=OrganizationRead, status_code=201)
def create_organization(
    payload: OrganizationCreate,
    current_admin: OrganizationsEditUser = None,
    db: Session = Depends(get_db),
):
    org = Organization(**payload.model_dump())
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@app.delete("/organizations/{org_id}", status_code=204)
def delete_organization(
    org_id: int,
    current_admin: OrganizationsEditUser = None,
    db: Session = Depends(get_db),
):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if org.image_path:
        delete_file(org.image_path)
    db.delete(org)
    db.commit()


@app.post("/organizations/{org_id}/image", response_model=OrganizationRead)
async def upload_organization_image(
    org_id: int,
    file: UploadFile = File(...),
    current_admin: OrganizationsEditUser = None,
    db: Session = Depends(get_db),
):
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if org.image_path:
        delete_file(org.image_path)
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    org.image_path = file_path
    db.commit()
    db.refresh(org)
    return org


@app.post("/allies/{ally_id}/image", response_model=AllyRead)
async def upload_ally_image(
    ally_id: int,
    file: UploadFile = File(...),
    current_admin: NpcsEditUser = None,
    db: Session = Depends(get_db),
):
    ally = db.get(Ally, ally_id)
    if not ally:
        raise HTTPException(status_code=404, detail="Ally not found")
    if ally.image_path:
        delete_file(ally.image_path)
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    ally.image_path = file_path
    db.commit()
    db.refresh(ally)
    return ally


@app.post("/creatures/{creature_id}/image", response_model=CreatureRead)
async def upload_creature_image(
    creature_id: int,
    file: UploadFile = File(...),
    current_user: BestiaryEditUser = None,
    db: Session = Depends(get_db),
):
    creature = db.get(Creature, creature_id)
    if not creature:
        raise HTTPException(status_code=404, detail="Creature not found")
    if creature.image_path:
        delete_file(creature.image_path)
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    creature.image_path = file_path
    db.commit()
    db.refresh(creature)
    return creature


@app.post("/diary/{entry_id}/image", response_model=DiaryEntryRead)
async def upload_diary_image(
    entry_id: int,
    file: UploadFile = File(...),
    current_user: TrackerEditUser = None,
    db: Session = Depends(get_db),
):
    entry = db.get(DiaryEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Diary entry not found")
    if entry.image_path:
        delete_file(entry.image_path)
    file_path = save_upload_file(file, MARKER_IMAGES_DIR)
    entry.image_path = file_path
    db.commit()
    db.refresh(entry)
    return entry


# ===== USER MANAGEMENT ENDPOINTS (Admin only) =====
@app.get("/users", response_model=list[UserWithPermissionsRead])
def list_users(
    current_admin: AdminPageUser = None,
    db: Session = Depends(get_db),
):
    """List all users (admin only)."""
    users = db.query(User).order_by(User.id.asc()).all()
    return [serialize_user_with_permissions(db, user) for user in users]


@app.post("/users", response_model=UserWithPermissionsRead, status_code=201)
def create_user_as_admin(
    payload: AdminUserCreate,
    current_admin: AdminPageUser = None,
    db: Session = Depends(get_db),
):
    existing_user = db.query(User).filter(User.username == payload.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=payload.username,
        hashed_password=get_password_hash(payload.password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    assign_page_permissions(db, user.id, DEFAULT_SELF_REGISTER_PERMISSIONS)
    db.commit()
    return serialize_user_with_permissions(db, user)


@app.put("/users/{user_id}/password", status_code=204)
def reset_user_password(
    user_id: int,
    payload: AdminPasswordReset,
    current_admin: AdminPageUser = None,
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = get_password_hash(payload.password)
    db.commit()


@app.put("/users/{user_id}/permissions/{page_key}", response_model=PagePermissionRead)
def update_user_permission(
    user_id: int,
    page_key: str,
    payload: PagePermissionUpdate,
    current_admin: AdminPageUser = None,
    db: Session = Depends(get_db),
):
    if page_key not in PAGE_KEYS:
        raise HTTPException(status_code=404, detail="Page not found")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    permissions = ensure_user_permissions(db, user)
    permission = next(item for item in permissions if item.page_key == page_key)
    if user.id == current_admin.id and page_key == "admin":
        raise HTTPException(status_code=400, detail="Cannot change your own admin page access")

    permission.permission_level = payload.permission_level
    db.commit()
    db.refresh(permission)
    return permission


