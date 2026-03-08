CREATE TABLE IF NOT EXISTS water_readings (
    time        TIMESTAMPTZ NOT NULL,
    site_id     TEXT NOT NULL,
    site_name   TEXT,
    parameter   TEXT NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    units       TEXT,
    qualifier   TEXT,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    source      TEXT NOT NULL DEFAULT 'usgs'
);

SELECT create_hypertable('water_readings', by_range('time'));

CREATE UNIQUE INDEX idx_water_readings_unique
    ON water_readings (time, site_id, parameter);
CREATE INDEX idx_water_readings_site ON water_readings (site_id, time DESC);
CREATE INDEX idx_water_readings_param ON water_readings (parameter, time DESC);
