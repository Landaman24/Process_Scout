from fastapi.testclient import TestClient

from app.main import app


def test_health_root():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_v1():
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_branding_default():
    client = TestClient(app)
    response = client.get("/api/v1/branding")
    assert response.status_code == 200
    body = response.json()
    assert body["client_name"] == "ProcessScout"
    assert body["powered_by"] == "ProcessScout"
