CREATE TABLE IF NOT EXISTS epa_daily_summaries (
    date            DATE NOT NULL,
    state_code      TEXT NOT NULL DEFAULT '06',
    county_code     TEXT NOT NULL,
    county_name     TEXT,
    site_number     TEXT NOT NULL,
    parameter_code  TEXT NOT NULL,
    parameter_name  TEXT,
    aqi             INTEGER,
    arithmetic_mean DOUBLE PRECISION,
    first_max_value DOUBLE PRECISION,
    units           TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    geom            GEOMETRY(Point, 4326),
    source          TEXT NOT NULL DEFAULT 'epa_aqs'
);

SELECT create_hypertable('epa_daily_summaries', by_range('date'));

CREATE UNIQUE INDEX idx_epa_daily_unique
    ON epa_daily_summaries (date, state_code, county_code, site_number, parameter_code);
CREATE INDEX idx_epa_daily_county ON epa_daily_summaries (county_code, date DESC);
CREATE INDEX idx_epa_daily_param ON epa_daily_summaries (parameter_code, date DESC);
CREATE INDEX idx_epa_daily_geom ON epa_daily_summaries USING GIST (geom);
