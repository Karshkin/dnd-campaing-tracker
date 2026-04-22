#!/usr/bin/env python
"""Script to create or promote an admin user."""
import sys
from getpass import getpass

from app.auth import get_password_hash
from app.database import DATABASE_URL, SessionLocal
from app.migrations import apply_project_migrations
from app.models import User


def main():
    apply_project_migrations(DATABASE_URL)
    db = SessionLocal()
    try:
        existing_admins = db.query(User).filter(User.is_admin == True).count()
        if existing_admins > 0:
            print("Error: An admin user already exists. Use the Admin panel (#admin) to promote users.")
            sys.exit(1)

        print("Create/Promote Admin User")
        print("-" * 40)
        username = input("Username: ").strip()
        if not username:
            print("Error: Username cannot be empty")
            sys.exit(1)

        existing = db.query(User).filter(User.username == username).first()
        if existing:
            existing.is_admin = True
            db.commit()
            print(f"\n✓ User '{username}' promoted to admin! Log out and back in to apply.")
            return

        password = getpass("Password (new user): ")
        password_confirm = getpass("Confirm password: ")

        if password != password_confirm:
            print("Error: Passwords do not match")
            sys.exit(1)

        if len(password) < 4:
            print("Error: Password must be at least 4 characters")
            sys.exit(1)

        admin = User(
            username=username,
            hashed_password=get_password_hash(password),
            is_admin=True,
        )
        db.add(admin)
        db.commit()

        print(f"\n✓ Admin user '{username}' created successfully!")

    finally:
        db.close()


if __name__ == "__main__":
    main()
