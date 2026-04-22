CREATE TABLE IF NOT EXISTS page_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    page_key VARCHAR(50) NOT NULL,
    permission_level VARCHAR(20) NOT NULL DEFAULT 'none',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_page_permissions_user_page UNIQUE (user_id, page_key)
);

CREATE INDEX IF NOT EXISTS ix_page_permissions_id ON page_permissions (id);
CREATE INDEX IF NOT EXISTS ix_page_permissions_user_id ON page_permissions (user_id);

INSERT OR IGNORE INTO page_permissions (user_id, page_key, permission_level)
SELECT id, 'tracker', 'view' FROM users;

INSERT OR IGNORE INTO page_permissions (user_id, page_key, permission_level)
SELECT id, 'characters', 'edit' FROM users;

INSERT OR IGNORE INTO page_permissions (user_id, page_key, permission_level)
SELECT id, 'bestiary', CASE WHEN is_admin = 1 THEN 'admin' ELSE 'view' END FROM users;

INSERT OR IGNORE INTO page_permissions (user_id, page_key, permission_level)
SELECT id, 'organizations', CASE WHEN is_admin = 1 THEN 'admin' ELSE 'view' END FROM users;

INSERT OR IGNORE INTO page_permissions (user_id, page_key, permission_level)
SELECT id, 'npcs', CASE WHEN is_admin = 1 THEN 'admin' ELSE 'view' END FROM users;

INSERT OR IGNORE INTO page_permissions (user_id, page_key, permission_level)
SELECT id, 'admin', CASE WHEN is_admin = 1 THEN 'admin' ELSE 'none' END FROM users;
