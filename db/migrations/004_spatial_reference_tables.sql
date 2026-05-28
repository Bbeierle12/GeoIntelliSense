CREATE TABLE IF NOT EXISTS wells (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_number  TEXT UNIQUE,
    name        TEXT,
    geom        GEOMETRY(Point, 4326) NOT NULL,
    well_type   TEXT,
    status      TEXT,
    depth_ft    DOUBLE PRECISION,
    county      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wells_geom ON wells USING GIST (geom);

CREATE TABLE IF NOT EXISTS census_tracts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geoid       TEXT NOT NULL UNIQUE,
    name        TEXT,
    geom        GEOMETRY(MultiPolygon, 4326) NOT NULL,
    state_fips  TEXT,
    county_fips TEXT,
    population  INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_census_tracts_geom ON census_tracts USING GIST (geom);

CREATE TABLE IF NOT EXISTS parcels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parcel_id   TEXT UNIQUE,
    geom        GEOMETRY(MultiPolygon, 4326) NOT NULL,
    owner       TEXT,
    address     TEXT,
    county      TEXT,
    acreage     DOUBLE PRECISION,
    land_use    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parcels_geom ON parcels USING GIST (geom);
