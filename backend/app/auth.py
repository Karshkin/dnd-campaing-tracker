from datetime import datetime, timedelta, timezone
from typing import Annotated
import os

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import PagePermission, User
from .schemas import TokenData

load_dotenv()

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
PERMISSION_RANK = {
    "none": 0,
    "view": 1,
    "edit": 2,
    "admin": 3,
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def authenticate_user(db: Session, username: str, password: str) -> User | bool:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user


def has_permission_level(actual: str, required: str) -> bool:
    return PERMISSION_RANK.get(actual, 0) >= PERMISSION_RANK.get(required, 0)


def get_user_page_permission(db: Session, user: User, page_key: str) -> str:
    if user.is_admin:
        return "admin"

    permission = (
        db.query(PagePermission)
        .filter(PagePermission.user_id == user.id, PagePermission.page_key == page_key)
        .first()
    )
    return permission.permission_level if permission else "none"


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username, is_admin=payload.get("is_admin", False))
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise credentials_exception
    return user


async def get_current_admin_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user


async def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Get any authenticated user (admin or regular)."""
    return current_user


def require_page_permission(page_key: str, required_level: str):
    async def dependency(
        current_user: Annotated[User, Depends(get_current_user)],
        db: Session = Depends(get_db),
    ) -> User:
        actual_level = get_user_page_permission(db, current_user, page_key)
        if not has_permission_level(actual_level, required_level):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return current_user

    return dependency
