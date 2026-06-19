CREATE TABLE IF NOT EXISTS soil_map_units (
    mukey TEXT PRIMARY KEY,
    muname TEXT NOT NULL,
    geom GEOMETRY(MultiPolygon, 4326),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_soil_mu_geom ON soil_map_units USING GIST (geom);

CREATE TABLE IF NOT EXISTS soil_components (
    cokey TEXT PRIMARY KEY,
    mukey TEXT NOT NULL REFERENCES soil_map_units(mukey),
    compname TEXT NOT NULL,
    comppct_r SMALLINT,
    drainagecl TEXT,
    hydgrp TEXT,
    taxclname TEXT,
    frostact TEXT,
    flodfreqcl TEXT,
    wtdepannmin REAL
);
CREATE INDEX IF NOT EXISTS idx_soil_comp_mukey ON soil_components(mukey);

CREATE TABLE IF NOT EXISTS soil_horizons (
    chkey TEXT PRIMARY KEY,
    cokey TEXT NOT NULL REFERENCES soil_components(cokey),
    hzname TEXT,
    hzdept_r REAL,
    hzdepb_r REAL,
    sandtotal_r REAL,
    silttotal_r REAL,
    claytotal_r REAL,
    om_r REAL,
    ph1to1h2o_r REAL,
    ksat_r REAL,
    awc_r REAL
);
CREATE INDEX IF NOT EXISTS idx_soil_hz_cokey ON soil_horizons(cokey);
