import importlib
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import database
from app import migrations
from app.migrations import ensure_migrations_table, get_applied_migrations, run_migrations


def import_module_fresh(module_name: str):
    sys.modules.pop(module_name, None)
    return importlib.import_module(module_name)


def test_run_migrations_applies_sql_files_in_order(tmp_path):
    db_path = tmp_path / "migration-test.db"
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()

    (migrations_dir / "001_create_table.sql").write_text(
        """
        CREATE TABLE example_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );
        """.strip(),
        encoding="utf-8",
    )
    (migrations_dir / "002_add_column.sql").write_text(
        "ALTER TABLE example_items ADD COLUMN notes TEXT DEFAULT '';",
        encoding="utf-8",
    )

    run_migrations(db_path, migrations_dir)

    connection = sqlite3.connect(db_path)
    try:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(example_items)").fetchall()
        }
        applied = [
            row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        ]
    finally:
        connection.close()

    assert columns == {"id", "name", "notes"}
    assert applied == ["001_create_table.sql", "002_add_column.sql"]


def test_run_migrations_is_idempotent(tmp_path):
    db_path = tmp_path / "migration-test.db"
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()

    (migrations_dir / "001_create_table.sql").write_text(
        "CREATE TABLE example_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);",
        encoding="utf-8",
    )

    run_migrations(db_path, migrations_dir)
    run_migrations(db_path, migrations_dir)

    connection = sqlite3.connect(db_path)
    try:
        applied_count = connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
    finally:
        connection.close()

    assert applied_count == 1


def test_ensure_migrations_table_creates_tracking_table(tmp_path):
    db_path = tmp_path / "migration-test.db"
    connection = sqlite3.connect(db_path)
    try:
        ensure_migrations_table(connection)
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    finally:
        connection.close()

    assert "schema_migrations" in tables


def test_get_applied_migrations_returns_sorted_versions(tmp_path):
    db_path = tmp_path / "migration-test.db"
    connection = sqlite3.connect(db_path)
    try:
        ensure_migrations_table(connection)
        connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", ("002_second.sql",))
        connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", ("001_first.sql",))
        connection.commit()

        applied = get_applied_migrations(connection)
    finally:
        connection.close()

    assert applied == {"001_first.sql", "002_second.sql"}


@pytest.mark.parametrize(
    ("database_url", "expected_name"),
    [
        ("sqlite:///./campaign.db", "campaign.db"),
        ("sqlite:////tmp/campaign.db", "campaign.db"),
    ],
)
def test_get_sqlite_db_path_resolves_file_path(tmp_path, database_url, expected_name):
    db_path = migrations.get_sqlite_db_path(database_url, base_dir=tmp_path)

    assert db_path.name == expected_name


def test_get_sqlite_db_path_rejects_in_memory_sqlite_url(tmp_path):
    with pytest.raises(ValueError, match="file-based SQLite"):
        migrations.get_sqlite_db_path("sqlite:///:memory:", base_dir=tmp_path)


def test_apply_project_migrations_uses_database_url_and_default_directory(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'campaign.db'}"
    captured: dict[str, Path] = {}

    def fake_run_migrations(db_path, migrations_dir=None):
        captured["db_path"] = Path(db_path)
        captured["migrations_dir"] = Path(migrations_dir)
        return ["001_initial.sql"]

    monkeypatch.setattr(migrations, "run_migrations", fake_run_migrations)
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", tmp_path / "migrations")

    applied = migrations.apply_project_migrations(database_url, base_dir=tmp_path)

    assert applied == ["001_initial.sql"]
    assert captured["db_path"] == tmp_path / "campaign.db"
    assert captured["migrations_dir"] == tmp_path / "migrations"


def test_main_runs_project_migrations(tmp_path, monkeypatch):
    calls: list[tuple[str, Path]] = []

    def fake_apply_project_migrations(database_url, base_dir=None):
        calls.append((database_url, Path(base_dir)))
        return ["001_initial.sql"]

    monkeypatch.setattr(migrations, "apply_project_migrations", fake_apply_project_migrations)

    exit_code = migrations.main(["--database-url", "sqlite:///./custom.db", "--base-dir", str(tmp_path)])

    assert exit_code == 0
    assert calls == [("sqlite:///./custom.db", tmp_path)]


def test_main_defaults_to_app_database_url(monkeypatch):
    calls: list[tuple[str, Path]] = []

    def fake_apply_project_migrations(database_url, base_dir=None):
        calls.append((database_url, Path(base_dir)))
        return []

    monkeypatch.setattr(migrations, "apply_project_migrations", fake_apply_project_migrations)

    exit_code = migrations.main([])

    assert exit_code == 0
    assert calls == [(database.DATABASE_URL, Path.cwd())]


def test_database_url_uses_absolute_backend_db_path():
    expected = (Path(database.__file__).resolve().parent.parent / "campaign.db").resolve()

    assert Path(database.engine.url.database).is_absolute()
    assert Path(database.engine.url.database) == expected


def test_app_startup_runs_project_migrations(monkeypatch):
    module = import_module_fresh("app.main")
    calls: list[str] = []

    def fake_apply_project_migrations(database_url, base_dir=None):
        calls.append(database_url)
        return []

    monkeypatch.setattr(module, "apply_project_migrations", fake_apply_project_migrations)

    with TestClient(module.app):
        pass

    assert calls == [module.DATABASE_URL]


def test_create_admin_main_runs_project_migrations(monkeypatch):
    module = import_module_fresh("create_admin")
    calls: list[str] = []

    class FakeQuery:
        def filter(self, *args, **kwargs):
            return self

        def count(self):
            return 1

    class FakeSession:
        def query(self, model):
            return FakeQuery()

        def close(self):
            return None

    def fake_apply_project_migrations(database_url, base_dir=None):
        calls.append(database_url)
        return []

    monkeypatch.setattr(module, "apply_project_migrations", fake_apply_project_migrations)
    monkeypatch.setattr(module, "SessionLocal", lambda: FakeSession())

    with pytest.raises(SystemExit, match="1"):
        module.main()

    assert calls == [module.DATABASE_URL]


def test_project_migrations_upgrade_legacy_schema(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(50) NOT NULL UNIQUE,
                hashed_password VARCHAR(255) NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE maps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(120) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                file_path VARCHAR(255) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE map_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(120) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                event_type VARCHAR(30) NOT NULL DEFAULT 'event',
                latitude FLOAT NOT NULL,
                longitude FLOAT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE diary_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(120) NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE resources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(120) NOT NULL UNIQUE,
                quantity INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE points_of_interest (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL REFERENCES maps(id),
                title VARCHAR(120) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                poi_type VARCHAR(30) NOT NULL DEFAULT 'location',
                latitude FLOAT NOT NULL,
                longitude FLOAT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE characters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name VARCHAR(120) NOT NULL,
                character_class VARCHAR(50) NOT NULL DEFAULT '',
                level INTEGER NOT NULL DEFAULT 1,
                race VARCHAR(50) NOT NULL DEFAULT '',
                sheet_file_path VARCHAR(255) NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE character_inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id INTEGER NOT NULL REFERENCES characters(id),
                item_name VARCHAR(120) NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                description TEXT NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE character_diary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id INTEGER NOT NULL REFERENCES characters(id),
                title VARCHAR(120) NOT NULL,
                content TEXT NOT NULL,
                session_date DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE creatures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                added_by_user_id INTEGER NOT NULL REFERENCES users(id),
                name VARCHAR(120) NOT NULL,
                creature_type VARCHAR(50) NOT NULL DEFAULT '',
                challenge_rating VARCHAR(20) NOT NULL DEFAULT '',
                armor_class INTEGER NOT NULL DEFAULT 0,
                hit_points VARCHAR(50) NOT NULL DEFAULT '',
                speed VARCHAR(100) NOT NULL DEFAULT '',
                abilities TEXT NOT NULL DEFAULT '',
                weaknesses TEXT NOT NULL DEFAULT '',
                resistances TEXT NOT NULL DEFAULT '',
                immunities TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE allies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                added_by_user_id INTEGER NOT NULL REFERENCES users(id),
                name VARCHAR(120) NOT NULL,
                role VARCHAR(100) NOT NULL DEFAULT '',
                location VARCHAR(120) NOT NULL DEFAULT '',
                relationship TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        connection.commit()
    finally:
        connection.close()

    run_migrations(db_path, migrations.MIGRATIONS_DIR)

    connection = sqlite3.connect(db_path)
    try:
        map_event_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(map_events)").fetchall()
        }
        character_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(characters)").fetchall()
        }
        ally_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(allies)").fetchall()
        }
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    finally:
        connection.close()

    assert {"map_id", "image_path"}.issubset(map_event_columns)
    assert {"organization_id", "image_path"}.issubset(character_columns)
    assert {"organization_id", "alignment", "image_path"}.issubset(ally_columns)
    assert {"organizations", "page_permissions", "schema_migrations"}.issubset(tables)


def test_run_migrations_records_duplicate_column_migration_as_applied(tmp_path):
    db_path = tmp_path / "migration-test.db"
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()

    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "CREATE TABLE example_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, notes TEXT)"
        )
        connection.commit()
    finally:
        connection.close()

    (migrations_dir / "001_add_existing_column.sql").write_text(
        "ALTER TABLE example_items ADD COLUMN notes TEXT;",
        encoding="utf-8",
    )

    applied = run_migrations(db_path, migrations_dir)

    connection = sqlite3.connect(db_path)
    try:
        recorded = [
            row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        ]
    finally:
        connection.close()

    assert applied == ["001_add_existing_column.sql"]
    assert recorded == ["001_add_existing_column.sql"]


def test_run_migrations_does_not_record_partial_multi_statement_migration(tmp_path):
    db_path = tmp_path / "migration-test.db"
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()

    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "CREATE TABLE example_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, notes TEXT)"
        )
        connection.commit()
    finally:
        connection.close()

    (migrations_dir / "001_partial_failure.sql").write_text(
        "ALTER TABLE example_items ADD COLUMN notes TEXT;\nCREATE TABLE extra_items (id INTEGER PRIMARY KEY AUTOINCREMENT);",
        encoding="utf-8",
    )

    with pytest.raises(sqlite3.OperationalError, match="duplicate column name"):
        run_migrations(db_path, migrations_dir)

    connection = sqlite3.connect(db_path)
    try:
        recorded = connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    finally:
        connection.close()

    assert recorded == 0
    assert "extra_items" not in tables


def test_run_migrations_skips_duplicate_version_insert(tmp_path, monkeypatch):
    db_path = tmp_path / "migration-test.db"
    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    migration_file = migrations_dir / "001_create_table.sql"
    migration_file.write_text(
        "CREATE TABLE IF NOT EXISTS example_items (id INTEGER PRIMARY KEY AUTOINCREMENT);",
        encoding="utf-8",
    )

    real_connect = migrations.sqlite3.connect

    class TrackingConnection:
        def __init__(self, inner):
            self.inner = inner
            self.insert_seen = False

        def execute(self, sql, parameters=()):
            if sql == "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)":
                if not self.insert_seen:
                    self.insert_seen = True
                    self.inner.execute(
                        "INSERT INTO schema_migrations (version) VALUES (?)",
                        parameters,
                    )
                    self.inner.commit()
            return self.inner.execute(sql, parameters)

        def executescript(self, sql):
            return self.inner.executescript(sql)

        def commit(self):
            return self.inner.commit()

        def rollback(self):
            return self.inner.rollback()

        def close(self):
            return self.inner.close()

        def __enter__(self):
            self.inner.__enter__()
            return self

        def __exit__(self, exc_type, exc, tb):
            return self.inner.__exit__(exc_type, exc, tb)

    def fake_connect(path):
        return TrackingConnection(real_connect(path))

    monkeypatch.setattr(migrations.sqlite3, "connect", fake_connect)

    applied = run_migrations(db_path, migrations_dir)

    connection = sqlite3.connect(db_path)
    try:
        recorded = [
            row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        ]
    finally:
        connection.close()

    assert applied == []
    assert recorded == ["001_create_table.sql"]


def test_run_migrations_creates_missing_indexes_for_preexisting_tables(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(50) NOT NULL UNIQUE,
                hashed_password VARCHAR(255) NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(120) NOT NULL,
                description TEXT DEFAULT '',
                image_path VARCHAR(255),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE page_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                page_key VARCHAR(50) NOT NULL,
                permission_level VARCHAR(20) NOT NULL DEFAULT 'none',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_page_permissions_user_page UNIQUE (user_id, page_key)
            );
            """
        )
        connection.commit()
    finally:
        connection.close()

    run_migrations(db_path, migrations.MIGRATIONS_DIR)

    connection = sqlite3.connect(db_path)
    try:
        indexes = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            ).fetchall()
        }
    finally:
        connection.close()

    assert "ix_users_id" in indexes
    assert "ix_organizations_id" in indexes
    assert "ix_page_permissions_user_id" in indexes


def test_run_migrations_backfills_page_permissions_for_existing_users(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(50) NOT NULL UNIQUE,
                hashed_password VARCHAR(255) NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO users (username, hashed_password, is_admin) VALUES ('player', 'hash', 0);
            """
        )
        connection.commit()
    finally:
        connection.close()

    run_migrations(db_path, migrations.MIGRATIONS_DIR)

    connection = sqlite3.connect(db_path)
    try:
        permissions = connection.execute(
            "SELECT page_key, permission_level FROM page_permissions WHERE user_id = 1 ORDER BY page_key"
        ).fetchall()
    finally:
        connection.close()

    assert permissions == [
        ("admin", "none"),
        ("bestiary", "view"),
        ("characters", "edit"),
        ("npcs", "view"),
        ("organizations", "view"),
        ("tracker", "view"),
    ]
