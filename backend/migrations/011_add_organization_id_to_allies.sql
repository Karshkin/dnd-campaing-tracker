ALTER TABLE allies ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
