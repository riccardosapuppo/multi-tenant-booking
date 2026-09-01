-- The shared database: who exists, and which centres exist.
--
-- Small, read on every request, and the only database that is not per-centre.
-- What lives here is exactly what has to be true across the whole platform:
--
--   * a person has one account and one password, and books at whichever centre
--     they like. Splitting identity per centre would mean registering again at
--     each one, which is a worse product and a bigger surface;
--   * the register of centres, which the tenant resolver reads before anything
--     else can happen;
--   * how each centre differs, as data.
--
-- Everything clinical is somewhere else: one database per centre, from
-- tenant-template.sql.

CREATE TABLE IF NOT EXISTS centres (
    id            SERIAL PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    timezone      TEXT NOT NULL DEFAULT 'Europe/Rome',
    active        BOOLEAN NOT NULL DEFAULT TRUE,

    -- How this centre differs from the others.
    --
    -- This column replaces something specific. The original decided one
    -- centre's behaviour with a line in a shared code path that compared the
    -- centre identifier against a constant and picked a different table. It
    -- worked, it was invisible from outside, and nothing listed the places it
    -- had been done. Differences between centres belong in the register: they
    -- can be listed, changed by an administrator, and read by whoever comes
    -- next.
    options       JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Anchored at both ends: this becomes part of a database name during
    -- provisioning. Checked in the application too — twice on purpose.
    CONSTRAINT centres_slug_shape CHECK (slug ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$')
);

CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_email_unique UNIQUE (email)
);

-- What somebody may do, and where.
--
-- A role on its own is not enough: "staff" means nothing until you say at
-- which centre. So the grant carries the centre, and a person can be staff at
-- one centre and a patient at another without either fact leaking into the
-- other.
--
-- `platform_admin` is the exception and carries no centre: it is the role that
-- exists to create centres, and it cannot be granted per centre without a
-- centre to grant it at. NULL centre_id is meaningful here, not missing data.
CREATE TABLE IF NOT EXISTS grants (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    centre_id  INTEGER REFERENCES centres(id) ON DELETE CASCADE,

    CONSTRAINT grants_role_known CHECK (role IN ('patient', 'staff', 'centre_admin', 'platform_admin')),
    CONSTRAINT grants_centre_required CHECK (
        (role = 'platform_admin' AND centre_id IS NULL)
        OR (role <> 'platform_admin' AND centre_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS grants_one_per_role_and_centre
    ON grants (user_id, role, COALESCE(centre_id, 0));

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
