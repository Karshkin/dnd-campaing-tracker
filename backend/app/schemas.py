from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MapEventBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    event_type: Literal["event", "quest"] = "event"
    latitude: float = Field(ge=0, le=100)
    longitude: float = Field(ge=0, le=100)


class MapEventCreate(MapEventBase):
    pass


class MapEventUpdate(MapEventBase):
    pass


class MapEventRead(MapEventBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class DiaryEntryBase(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)


class DiaryEntryCreate(DiaryEntryBase):
    pass


class DiaryEntryRead(DiaryEntryBase):
    id: int
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
    updated_at: datetime

    model_config = {"from_attributes": True}
