CREATE DATABASE booking_alpha OWNER booking_demo;
CREATE DATABASE booking_beta OWNER booking_demo;
CREATE DATABASE booking_gamma OWNER booking_demo;

\connect tenant_registry

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  database_name TEXT NOT NULL UNIQUE
);

INSERT INTO tenants (id, slug, display_name, database_name) VALUES
  ('tenant-alpha', 'alpha', 'Demo Center Alpha', 'booking_alpha'),
  ('tenant-beta', 'beta', 'Demo Center Beta', 'booking_beta'),
  ('tenant-gamma', 'gamma', 'Demo Center Gamma', 'booking_gamma');
