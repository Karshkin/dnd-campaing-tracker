import sqlite3
import sys
from pathlib import Path
from urllib.parse import unquote

from .database import DATABASE_URL


MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def ensure_migrations_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.commit()


def get_applied_migrations(connection: sqlite3.Connection) -> set[str]:
    ensure_migrations_table(connection)
    rows = connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    return {row[0] for row in rows}


def get_migration_files(migrations_dir: Path) -> list[Path]:
    return sorted(path for path in migrations_dir.glob("*.sql") if path.is_file())


def is_already_applied_error(error: sqlite3.OperationalError) -> bool:
    message = str(error).lower()
    return "duplicate column name" in message


def get_sqlite_db_path(database_url: str, base_dir: str | Path | None = None) -> Path:
    if not database_url.startswith("sqlite:///"):
        raise ValueError("Migrations require a file-based SQLite database URL")

    raw_path = unquote(database_url.removeprefix("sqlite:///"))
    if raw_path == ":memory:":
        raise ValueError("Migrations require a file-based SQLite database URL")

    if raw_path.startswith("./") or raw_path.startswith("../"):
        root = Path(base_dir) if base_dir is not None else Path.cwd()
        return (root / raw_path).resolve()
    if raw_path.startswith("/"):
        return Path(raw_path)
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return candidate.resolve()


def apply_project_migrations(database_url: str, base_dir: str | Path | None = None) -> list[str]:
    db_path = get_sqlite_db_path(database_url, base_dir=base_dir)
    return run_migrations(db_path, MIGRATIONS_DIR)


def record_migration(connection: sqlite3.Connection, version: str) -> bool:
    cursor = connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
        (version,),
    )
    return cursor.rowcount == 1


def is_single_statement(sql: str) -> bool:
    statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
    return len(statements) == 1


def main(argv: list[str] | None = None) -> int:
    args = list(argv or [])
    database_url = DATABASE_URL
    base_dir = Path.cwd()

    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--database-url":
            index += 1
            if index >= len(args):
                raise ValueError("--database-url requires a value")
            database_url = args[index]
        elif arg == "--base-dir":
            index += 1
            if index >= len(args):
                raise ValueError("--base-dir requires a value")
            base_dir = Path(args[index])
        else:
            raise ValueError(f"Unknown argument: {arg}")
        index += 1

    applied_versions = apply_project_migrations(database_url, base_dir=base_dir)
    if applied_versions:
        print(f"Applied migrations: {', '.join(applied_versions)}")
    else:
        print("No migrations to apply.")
    return 0


def run_migrations(db_path: str | Path, migrations_dir: Path | None = None) -> list[str]:
    migrations_path = Path(migrations_dir) if migrations_dir is not None else MIGRATIONS_DIR
    connection = sqlite3.connect(str(db_path))
    applied_versions: list[str] = []

    try:
        ensure_migrations_table(connection)
        existing_versions = get_applied_migrations(connection)

        for migration_file in get_migration_files(migrations_path):
            version = migration_file.name
            if version in existing_versions:
                continue

            sql = migration_file.read_text(encoding="utf-8")
            try:
                with connection:
                    connection.executescript(sql)
                    inserted = record_migration(connection, version)
            except sqlite3.OperationalError as error:
                if not is_already_applied_error(error) or not is_single_statement(sql):
                    raise
                with connection:
                    inserted = record_migration(connection, version)

            if inserted:
                applied_versions.append(version)
            existing_versions.add(version)
    finally:
        connection.close()

    return applied_versions


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
