from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_PATH = (Path(__file__).resolve().parent.parent / "campaign.db").resolve()
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
