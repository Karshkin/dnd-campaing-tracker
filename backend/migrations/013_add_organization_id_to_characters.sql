ALTER TABLE characters ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
