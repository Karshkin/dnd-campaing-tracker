from fastapi.testclient import TestClient
from uuid import uuid4
import pytest

from app.main import app
from app.database import SessionLocal
from app.models import User
from app.auth import get_password_hash

client = TestClient(app)


def get_admin_token():
    """Create admin user and get auth token for tests"""
    db = SessionLocal()
    try:
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

    list_response = client.get("/events")
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
