from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MapEventBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    event_type: Literal["event", "quest"] = "event"
    latitude: float = Field(ge=0, le=100)
    longitude: float = Field(ge=0, le=100)
    map_id: int | None = None


class MapEventCreate(MapEventBase):
    pass


class MapEventUpdate(MapEventBase):
    pass


class MapEventRead(MapEventBase):
    id: int
    image_path: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DiaryEntryBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)


class DiaryEntryCreate(DiaryEntryBase):
    pass


class DiaryEntryRead(DiaryEntryBase):
    id: int
    image_path: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResourceBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: int = Field(default=0, ge=0)
    notes: str = ""


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(ResourceBase):
    pass


class ResourceRead(ResourceBase):
    id: int
    image_path: str | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserLogin(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8)


class UserRead(BaseModel):
    id: int
    username: str
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PagePermissionRead(BaseModel):
    page_key: str
    permission_level: Literal["none", "view", "edit", "admin"]

    model_config = {"from_attributes": True}


class PagePermissionUpdate(BaseModel):
    permission_level: Literal["none", "view", "edit", "admin"]


class UserWithPermissionsRead(UserRead):
    permissions: list[PagePermissionRead]


class CurrentUserRead(UserRead):
    permissions: list[PagePermissionRead]


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8)


class AdminPasswordReset(BaseModel):
    password: str = Field(min_length=8)


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: str | None = None
    is_admin: bool = False


# Organization schemas
class OrganizationBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationRead(OrganizationBase):
    id: int
    image_path: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# Map schemas
class MapBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    is_active: bool = True


class MapCreate(MapBase):
    pass


class MapRead(MapBase):
    id: int
    file_path: str
    created_at: datetime

    model_config = {"from_attributes": True}


# Point of Interest schemas
class PointOfInterestBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    poi_type: Literal["location", "city", "dungeon", "landmark", "quest"] = "location"
    latitude: float = Field(ge=0, le=100)
    longitude: float = Field(ge=0, le=100)


class PointOfInterestCreate(PointOfInterestBase):
    map_id: int


class PointOfInterestUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    poi_type: Literal["location", "city", "dungeon", "landmark", "quest"] = "location"


class PointOfInterestRead(PointOfInterestBase):
    id: int
    map_id: int
    image_path: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# Character schemas
class CharacterBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    character_class: str = ""
    level: int = Field(default=1, ge=1, le=20)
    race: str = ""
    notes: str = ""
    organization_id: int | None = None


class CharacterCreate(CharacterBase):
    pass


class CharacterUpdate(CharacterBase):
    pass


class CharacterRead(CharacterBase):
    id: int
    user_id: int
    sheet_file_path: str
    image_path: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Character Inventory schemas
class CharacterInventoryBase(BaseModel):
    item_name: str = Field(min_length=1, max_length=120)
    quantity: int = Field(default=1, ge=1)
    description: str = ""


class CharacterInventoryCreate(CharacterInventoryBase):
    character_id: int


class CharacterInventoryRead(CharacterInventoryBase):
    id: int
    character_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# Character Diary schemas
class CharacterDiaryBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)
    session_date: datetime | None = None


class CharacterDiaryCreate(CharacterDiaryBase):
    character_id: int


class CharacterDiaryRead(CharacterDiaryBase):
    id: int
    character_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# Creature schemas
class CreatureBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    creature_type: str = ""
    challenge_rating: str = ""
    armor_class: int = Field(default=0, ge=0)
    hit_points: str = ""
    speed: str = ""
    abilities: str = ""
    weaknesses: str = ""
    resistances: str = ""
    immunities: str = ""
    notes: str = ""


class CreatureCreate(CreatureBase):
    pass


class CreatureRead(CreatureBase):
    id: int
    added_by_user_id: int
    image_path: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# Ally schemas
class AllyBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = ""
    location: str = ""
    relationship: str = ""
    notes: str = ""
    organization_id: int | None = None
    alignment: Literal["allied", "foe", "neutral"] = "neutral"


class AllyCreate(AllyBase):
    pass


class AllyRead(AllyBase):
    id: int
    added_by_user_id: int
    image_path: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
