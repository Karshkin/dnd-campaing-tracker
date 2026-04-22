from fastapi.testclient import TestClient
from uuid import uuid4
import pytest

from app.main import app
from app.database import SessionLocal
from app.models import PagePermission, User
from app.auth import get_password_hash

client = TestClient(app)

DEFAULT_PERMISSIONS = {
    "tracker": "view",
    "characters": "edit",
    "bestiary": "view",
    "organizations": "view",
    "npcs": "view",
    "admin": "none",
}


def get_admin_token():
    """Create admin user and get auth token for tests"""
    db = SessionLocal()
    try:
        db.query(PagePermission).delete()
        # Clean up test admin if exists
        db.query(User).filter(User.username == "testadmin").delete()
        db.commit()

        # Create test admin
        admin = User(
            username="testadmin",
            hashed_password=get_password_hash("testpassword"),
            is_admin=True,
        )
        db.add(admin)
        db.commit()
    finally:
        db.close()

    # Login to get token
    response = client.post(
        "/login",
        data={"username": "testadmin", "password": "testpassword"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
def auth_headers():
    """Fixture to provide authentication headers"""
    token = get_admin_token()
    return {"Authorization": f"Bearer {token}"}


def create_regular_user_and_token(username: str, password: str) -> str:
    response = client.post(
        "/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_create_and_list_event(auth_headers):
    create_response = client.post(
        "/events",
        json={
            "title": "Ambush at the Bridge",
            "description": "Bandits were spotted near the stone bridge.",
            "event_type": "quest",
            "latitude": 47.5,
            "longitude": 33.2,
        },
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["title"] == "Ambush at the Bridge"

    list_response = client.get("/events", headers=auth_headers)
    assert list_response.status_code == 200
    events = list_response.json()
    assert any(item["id"] == payload["id"] for item in events)


def test_create_resource_duplicate_name_is_rejected(auth_headers):
    resource_name = f"Gold-{uuid4()}"
    first = client.post("/resources", json={"name": resource_name, "quantity": 100, "notes": "Party stash"}, headers=auth_headers)
    assert first.status_code == 201

    duplicate = client.post("/resources", json={"name": resource_name, "quantity": 80, "notes": "Extra"}, headers=auth_headers)
    assert duplicate.status_code == 400


def test_update_resource_duplicate_name_is_rejected(auth_headers):
    name_one = f"Resource-{uuid4()}"
    name_two = f"Resource-{uuid4()}"

    first = client.post("/resources", json={"name": name_one, "quantity": 10, "notes": ""}, headers=auth_headers)
    second = client.post("/resources", json={"name": name_two, "quantity": 20, "notes": ""}, headers=auth_headers)
    assert first.status_code == 201
    assert second.status_code == 201

    update = client.put(
        f"/resources/{second.json()['id']}",
        json={"name": name_one, "quantity": 30, "notes": "trying duplicate name"},
        headers=auth_headers,
    )
    assert update.status_code == 400


def test_unauthorized_access_to_protected_endpoints():
    """Test that protected endpoints require authentication"""
    # Try to create event without auth
    response = client.post(
        "/events",
        json={
            "title": "Test Event",
            "description": "Should fail",
            "event_type": "event",
            "latitude": 50.0,
            "longitude": 50.0,
        },
    )
    assert response.status_code == 401

    # Try to create resource without auth
    response = client.post("/resources", json={"name": "Test Resource", "quantity": 10, "notes": ""})
    assert response.status_code == 401

    # Try to create diary entry without auth
    response = client.post("/diary", json={"title": "Test", "content": "Should fail"})
    assert response.status_code == 401


def test_init_admin():
    """Test admin initialization endpoint"""
    db = SessionLocal()
    try:
        # Clear all users
        db.query(PagePermission).delete()
        db.query(User).delete()
        db.commit()
    finally:
        db.close()

    # Create first admin
    response = client.post("/init-admin", json={"username": "newadmin", "password": "securepass"})
    assert response.status_code == 201

    # Try to create another admin (should fail)
    response = client.post("/init-admin", json={"username": "secondadmin", "password": "anotherpass"})
    assert response.status_code == 400


def test_register_assigns_default_permissions():
    username = f"player-{uuid4().hex[:8]}"
    password = "strongpass123"

    response = client.post("/register", json={"username": username, "password": password})
    assert response.status_code == 201

    token_response = client.post(
        "/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert token_response.status_code == 200

    me_response = client.get(
        "/me",
        headers={"Authorization": f"Bearer {token_response.json()['access_token']}"},
    )
    assert me_response.status_code == 200

    permission_map = {
        item["page_key"]: item["permission_level"]
        for item in me_response.json()["permissions"]
    }
    assert permission_map == DEFAULT_PERMISSIONS


def test_admin_can_create_user_with_default_permissions(auth_headers):
    response = client.post(
        "/users",
        json={"username": f"user-{uuid4().hex[:8]}", "password": "strongpass123"},
        headers=auth_headers,
    )
    assert response.status_code == 201

    payload = response.json()
    permission_map = {
        item["page_key"]: item["permission_level"]
        for item in payload["permissions"]
    }
    assert permission_map == DEFAULT_PERMISSIONS


def test_admin_can_update_user_page_permission(auth_headers):
    username = f"user-{uuid4().hex[:8]}"
    created = client.post(
        "/users",
        json={"username": username, "password": "strongpass123"},
        headers=auth_headers,
    )
    assert created.status_code == 201

    user_id = created.json()["id"]
    update = client.put(
        f"/users/{user_id}/permissions/bestiary",
        json={"permission_level": "edit"},
        headers=auth_headers,
    )

    assert update.status_code == 200
    assert update.json()["page_key"] == "bestiary"
    assert update.json()["permission_level"] == "edit"


def test_admin_cannot_change_own_admin_permission(auth_headers):
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "testadmin").first()
        assert admin is not None
        admin_id = admin.id
    finally:
        db.close()

    response = client.put(
        f"/users/{admin_id}/permissions/admin",
        json={"permission_level": "view"},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_user_without_bestiary_edit_cannot_create_creature(auth_headers):
    username = f"user-{uuid4().hex[:8]}"
    password = "strongpass123"
    created = client.post(
        "/users",
        json={"username": username, "password": password},
        headers=auth_headers,
    )
    assert created.status_code == 201

    token = create_regular_user_and_token(username, password)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/creatures", json={"name": "Ogre"}, headers=headers)
    assert response.status_code == 403


def test_user_with_bestiary_view_can_list_but_not_edit(auth_headers):
    username = f"user-{uuid4().hex[:8]}"
    password = "strongpass123"
    created = client.post(
        "/users",
        json={"username": username, "password": password},
        headers=auth_headers,
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    update = client.put(
        f"/users/{user_id}/permissions/bestiary",
        json={"permission_level": "view"},
        headers=auth_headers,
    )
    assert update.status_code == 200

    token = create_regular_user_and_token(username, password)
    headers = {"Authorization": f"Bearer {token}"}
    list_response = client.get("/creatures", headers=headers)
    create_response = client.post("/creatures", json={"name": "Wraith"}, headers=headers)

    assert list_response.status_code == 200
    assert create_response.status_code == 403


def test_users_endpoint_returns_permissions(auth_headers):
    response = client.get("/users", headers=auth_headers)
    assert response.status_code == 200
    users = response.json()
    assert users
    assert "permissions" in users[0]


def test_legacy_admin_toggle_endpoints_are_removed(auth_headers):
    created = client.post(
        "/users",
        json={"username": f"legacy-{uuid4().hex[:8]}", "password": "strongpass123"},
        headers=auth_headers,
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    promote_response = client.post(f"/users/{user_id}/make-admin", headers=auth_headers)
    demote_response = client.post(f"/users/{user_id}/remove-admin", headers=auth_headers)

    assert promote_response.status_code == 404
    assert demote_response.status_code == 404


def test_register_persists_permission_rows():
    username = f"player-{uuid4().hex[:8]}"
    password = "strongpass123"

    response = client.post("/register", json={"username": username, "password": password})
    assert response.status_code == 201

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None
        rows = db.query(PagePermission).filter(PagePermission.user_id == user.id).all()
        assert len(rows) == len(DEFAULT_PERMISSIONS)
    finally:
        db.close()
