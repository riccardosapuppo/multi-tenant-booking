-- One centre's database. Applied once, when the centre is created.
--
-- Every centre gets its own copy of this, in a database of its own. That is
-- the isolation: a query here cannot reach another centre's rows by forgetting
-- a filter, because the other centre's rows are not in this database.
--
-- The shape follows the original, which was a real diagnostic centre's
-- schedule. Two things in it are worth keeping rather than simplifying away,
-- because they are what makes booking at a clinic different from booking a
-- table at a restaurant:
--
--   * a room is booked for an *exam*, and the exam decides how long it takes.
--     Slots are not a fixed grid; they are cut from a session by the duration
--     of what was asked for.
--   * a session holds quotas per payment category. A morning is not "twelve
--     slots": it is at most four exempt patients, at most six on the national
--     health service, the rest private. Run out of one and the morning is full
--     for that category and open for another. Modelling that away leaves a
--     booking system that cannot be used by the people it was built for.

CREATE TABLE IF NOT EXISTS sites (
    id       SERIAL PRIMARY KEY,
    name     TEXT NOT NULL,
    address  TEXT NOT NULL,
    active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Where an exam is performed. "Room" in the sense a radiographer means it: a
-- machine, a space and the people around it.
CREATE TABLE IF NOT EXISTS rooms (
    id        SERIAL PRIMARY KEY,
    site_id   INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    code      TEXT NOT NULL,
    name      TEXT NOT NULL,

    -- The DICOM modality this room performs: CT, MR, US, XR, MG.
    -- One room, one modality: a scanner is one machine.
    modality  TEXT NOT NULL,

    active    BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT rooms_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS exams (
    id           SERIAL PRIMARY KEY,
    code         TEXT NOT NULL,
    name         TEXT NOT NULL,
    modality     TEXT NOT NULL,

    -- What it costs, and how long the room is occupied. Both belong to the
    -- exam and not to the slot: the same half hour is one MRI or three x-rays.
    minutes      INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 480),
    price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),

    -- Whether this exam may be booked online at all. Some need a doctor to
    -- approve them first, and hiding them makes the centre look as though it
    -- does not perform them.
    bookable     BOOLEAN NOT NULL DEFAULT TRUE,
    notes        TEXT,

    CONSTRAINT exams_code_unique UNIQUE (code)
);

-- Which rooms can perform which exams. Not derivable from the modality alone:
-- two MRI rooms in the same centre rarely have the same coils.
CREATE TABLE IF NOT EXISTS room_exams (
    room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    exam_id  INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, exam_id)
);

-- When a room is open, and for whom.
--
-- The quota columns are the interesting part and they come straight from the
-- original. A session is not a number of slots: it is a window with limits per
-- payment category, and the limits are what a receptionist is actually
-- managing. `max_total` is not their sum — a morning can allow four exempt and
-- six private and still stop at eight in all.
CREATE TABLE IF NOT EXISTS room_schedules (
    id             SERIAL PRIMARY KEY,
    room_id        INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,

    valid_from     DATE NOT NULL,
    valid_to       DATE NOT NULL,

    -- Which weekdays this applies to: seven characters, Monday first,
    -- 'Y' or 'N'. Kept as the original had it — a pattern reads better than
    -- seven booleans, and a clinic's week is a pattern.
    weekdays       CHAR(7) NOT NULL,

    opens          TIME NOT NULL,
    closes         TIME NOT NULL,

    max_total      INTEGER,
    max_exempt     INTEGER,
    max_health_service INTEGER,
    max_private    INTEGER,
    max_insured    INTEGER,

    active         BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT room_schedules_window CHECK (closes > opens),
    CONSTRAINT room_schedules_dates CHECK (valid_to >= valid_from),
    CONSTRAINT room_schedules_weekdays CHECK (weekdays ~ '^[YN]{7}$')
);

CREATE INDEX IF NOT EXISTS room_schedules_by_room ON room_schedules (room_id, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS bookings (
    id            SERIAL PRIMARY KEY,
    reference     TEXT NOT NULL,

    -- The account that made it, from the shared database. Deliberately not a
    -- foreign key: the patient lives in another database, and pretending
    -- otherwise with a constraint that cannot be enforced is worse than
    -- writing down that it cannot.
    user_id       INTEGER NOT NULL,
    patient_name  TEXT NOT NULL,

    category      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'confirmed',

    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,

    total_cents   INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at  TIMESTAMPTZ,

    CONSTRAINT bookings_reference_unique UNIQUE (reference),
    CONSTRAINT bookings_window CHECK (ends_at > starts_at),
    CONSTRAINT bookings_category CHECK (category IN ('exempt', 'health_service', 'private', 'insured')),
    CONSTRAINT bookings_status CHECK (status IN ('confirmed', 'cancelled', 'attended', 'missed'))
);

CREATE INDEX IF NOT EXISTS bookings_by_room_and_time ON bookings (room_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_by_user ON bookings (user_id, starts_at DESC);

-- One booking, several exams. People book a knee and a shoulder in one visit,
-- and the second is not a correction of the first.
CREATE TABLE IF NOT EXISTS booking_items (
    id           SERIAL PRIMARY KEY,
    booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    exam_id      INTEGER NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,

    -- Copied at the time of booking rather than read through the exam. A price
    -- list changes; what somebody was quoted does not.
    price_cents  INTEGER NOT NULL,
    minutes      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS booking_items_by_booking ON booking_items (booking_id);
