import os
import uuid
from pathlib import Path

UPLOAD_DIR = Path("uploads")
CHARACTER_SHEETS_DIR = UPLOAD_DIR / "character_sheets"
MAPS_DIR = UPLOAD_DIR / "maps"
MARKER_IMAGES_DIR = UPLOAD_DIR / "marker_images"

# Create directories if they don't exist
CHARACTER_SHEETS_DIR.mkdir(parents=True, exist_ok=True)
MAPS_DIR.mkdir(parents=True, exist_ok=True)
MARKER_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def save_upload_file(file, directory: Path) -> str:
    """Save an uploaded file and return its path."""
    # Generate unique filename
    file_extension = Path(file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = directory / unique_filename

    # Save file
    with open(file_path, "wb") as buffer:
        content = file.file.read()
        buffer.write(content)

    # Return relative path for database storage
    return str(file_path)


def delete_file(file_path: str) -> bool:
    """Delete a file if it exists."""
    try:
        path = Path(file_path)
        if path.exists():
            path.unlink()
            return True
        return False
    except Exception:
        return False
