from fastapi.testclient import TestClient
from uuid import uuid4

from app.main import app

client = TestClient(app)


def test_create_and_list_event():
    create_response = client.post(
        "/events",
        json={
            "title": "Ambush at the Bridge",
            "description": "Bandits were spotted near the stone bridge.",
            "event_type": "quest",
            "latitude": 47.5,
            "longitude": 33.2,
        },
    )
    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["title"] == "Ambush at the Bridge"

    list_response = client.get("/events")
    assert list_response.status_code == 200
    events = list_response.json()
    assert any(item["id"] == payload["id"] for item in events)


def test_create_resource_duplicate_name_is_rejected():
    resource_name = f"Gold-{uuid4()}"
    first = client.post("/resources", json={"name": resource_name, "quantity": 100, "notes": "Party stash"})
    assert first.status_code == 201

    duplicate = client.post("/resources", json={"name": resource_name, "quantity": 80, "notes": "Extra"})
    assert duplicate.status_code == 400


def test_update_resource_duplicate_name_is_rejected():
    name_one = f"Resource-{uuid4()}"
    name_two = f"Resource-{uuid4()}"

    first = client.post("/resources", json={"name": name_one, "quantity": 10, "notes": ""})
    second = client.post("/resources", json={"name": name_two, "quantity": 20, "notes": ""})
    assert first.status_code == 201
    assert second.status_code == 201

    update = client.put(
        f"/resources/{second.json()['id']}",
        json={"name": name_one, "quantity": 30, "notes": "trying duplicate name"},
    )
    assert update.status_code == 400
