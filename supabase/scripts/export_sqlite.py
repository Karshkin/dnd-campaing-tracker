"""Prepare a private PostgreSQL import and Storage tree without contacting Supabase."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from tempfile import TemporaryDirectory
from uuid import UUID

TABLES = (
    "maps", "map_events", "points_of_interest", "resources", "diary_entries",
    "organizations", "characters", "character_inventory", "character_diary", "creatures", "allies",
)
MEDIA = {"file_path", "image_path", "sheet_file_path"}
IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"}


def literal(value):
    """Quote a PostgreSQL string with standard_conforming_strings enabled."""
    return "'" + value.replace("'", "''") + "'"


def export_media(row, table, field, root, destination):
    saved_path = Path(row[field].replace("\\", "/"))
    if not saved_path.parts or saved_path.parts[0] != "uploads":
        raise ValueError(f"{table} {row['id']}: expected an uploads/ path for {field}")
    source = root.joinpath(*saved_path.parts[1:]).resolve()
    if not source.is_relative_to(root) or not source.is_file():
        raise ValueError(f"{table} {row['id']}: missing file for {field}: {saved_path}")
    extension = source.suffix.lower()
    if extension not in IMAGES and not (field == "sheet_file_path" and extension == ".pdf"):
        raise ValueError(f"{table} {row['id']}: convert unsupported file {saved_path}")
    if not 0 < source.stat().st_size <= 50 * 1024 * 1024:
        raise ValueError(f"{table} {row['id']}: file must be between 1 byte and 50 MB: {saved_path}")
    with source.open("rb") as file:
        token = UUID(bytes=hashlib.file_digest(file, "sha256").digest()[:16])
    parent = Path(table)
    if table == "characters":
        parent /= row["user_id"]
    relative = parent / str(row["id"]) / f"{token}{extension}"
    output = destination / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, output)
    return relative.as_posix()


def export(connection, account_map, uploads, output):
    profiles = list(connection.execute("select id, username, is_admin, created_at from users"))
    expected = {row["id"] for row in profiles}
    if account_map.keys() != expected or len(set(account_map.values())) != len(expected):
        raise ValueError("Supply exactly one distinct Supabase Auth UUID for each legacy user ID")
    names = [row["username"].lower() for row in profiles]
    if len(set(names)) != len(names):
        raise ValueError("Resolve usernames that differ only by case before importing")

    objects = output / "objects"
    objects.mkdir()
    public_tables = ", ".join(f"public.{table}" for table in TABLES)
    with (output / "import.sql").open("w", encoding="utf-8") as sql:
        def write(line):
            sql.write(line + "\n")

        write("begin;")
        write("set local standard_conforming_strings = on;")
        write("set local timezone = 'UTC';")
        write(f"lock table public.profiles, public.page_permissions, {public_tables} in share row exclusive mode;")
        write("create temporary table legacy_accounts (legacy_id integer, auth_id uuid, username text) on commit drop;")
        for user in profiles:
            user_id = literal(account_map[user["id"]])
            username = literal(user["username"])
            write(f"insert into legacy_accounts values ({user['id']}, {user_id}, {username});")
        write("do $$ begin")
        for table in TABLES:
            write(f"  if exists (select 1 from public.{table}) then raise exception '{table} is not empty'; end if;")
        write("  if exists (select 1 from legacy_accounts l left join public.profiles p")
        write("      on p.id = l.auth_id and p.username = l.username where p.id is null) then")
        write("    raise exception 'A legacy account has a missing or mismatched profile';")
        write("  end if;")
        write("end; $$;")
        for user in profiles:
            user_id = literal(account_map[user["id"]])
            created_at = literal(user["created_at"])
            role = "true" if user["is_admin"] else "false"
            write(f"update public.profiles set is_admin = (is_admin or {role}), created_at = {created_at} where id = {user_id};")
        for permission in connection.execute("select user_id, page_key, permission_level from page_permissions"):
            user_id = literal(account_map[permission["user_id"]])
            page = literal(permission["page_key"])
            level = literal(permission["permission_level"])
            write(f"update public.page_permissions set permission_level = {level} where user_id = {user_id} and page_key = {page};")

        counts = {}
        for table in TABLES:
            cursor = connection.execute(f"select * from {table} order by id")
            columns = [column[0] for column in cursor.description]
            safe_columns = ", ".join('"' + name.replace('"', '""') + '"' for name in columns)
            count = 0
            for row in cursor:
                data = dict(row)
                for field in ("user_id", "added_by_user_id"):
                    if field in data:
                        data[field] = account_map[data[field]]
                if table == "maps":
                    data["is_active"] = bool(data["is_active"])
                for field in MEDIA.intersection(data):
                    if data[field]:
                        data[field] = export_media(data, table, field, uploads, objects)
                payload = literal(json.dumps(data, ensure_ascii=False, allow_nan=False))
                write(f"insert into public.{table} ({safe_columns}) overriding system value "
                      f"select {safe_columns} from jsonb_populate_record(null::public.{table}, {payload}::jsonb);")
                count += 1
            write(f"select setval(pg_get_serial_sequence('public.{table}', 'id'), "
                  f"coalesce((select max(id) from public.{table}), 1), exists (select 1 from public.{table}));")
            counts[table] = count
        write("commit;")
    (output / "counts.json").write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sqlite", type=Path, help="Migrated SQLite backup")
    parser.add_argument("uploads", type=Path, help="Directory containing legacy uploads")
    parser.add_argument("accounts", type=Path, help="JSON object mapping legacy user IDs to Auth UUIDs")
    parser.add_argument("output", type=Path, help="New private directory for SQL and files")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be a new directory")
    account_map = {int(old): str(UUID(new)) for old, new in json.loads(args.accounts.read_text()).items()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.output.parent) as temporary:
        prepared = Path(temporary) / "prepared"
        prepared.mkdir(mode=0o700)
        with sqlite3.connect(args.sqlite.resolve().as_uri() + "?mode=ro", uri=True) as connection:
            connection.row_factory = sqlite3.Row
            export(connection, account_map, args.uploads.resolve(), prepared)
        prepared.rename(args.output)
    print(f"Prepared {args.output / 'import.sql'}, objects/ and counts.json")


if __name__ == "__main__":
    main()
