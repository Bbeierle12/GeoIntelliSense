CREATE TABLE IF NOT EXISTS crop_coverage (
    year            INTEGER NOT NULL,
    county_fips     TEXT NOT NULL,
    crop_code       INTEGER NOT NULL,
    crop_name       TEXT NOT NULL,
    acreage         DOUBLE PRECISION NOT NULL,
    pixel_count     INTEGER,
    color           TEXT,
    source          TEXT NOT NULL DEFAULT 'cropscape'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crop_coverage_unique
    ON crop_coverage (year, county_fips, crop_code);
CREATE INDEX IF NOT EXISTS idx_crop_coverage_county ON crop_coverage (county_fips, year DESC);
CREATE INDEX IF NOT EXISTS idx_crop_coverage_crop ON crop_coverage (crop_name, year DESC);
