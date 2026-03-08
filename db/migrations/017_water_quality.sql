-- Water quality measurements from WQP (Water Quality Portal)
CREATE TABLE IF NOT EXISTS water_quality (
    id                  BIGSERIAL,
    time                TIMESTAMPTZ NOT NULL,
    site_id             TEXT NOT NULL,
    site_name           TEXT,
    geom                GEOMETRY(Point, 4326),
    parameter           TEXT NOT NULL,      -- e.g. Arsenic, Nitrate, pH
    value               DOUBLE PRECISION,
    unit                TEXT,
    detection_limit     DOUBLE PRECISION,
    detection_condition TEXT,               -- Not Detected, Present Above QL, etc.
    sample_media        TEXT DEFAULT 'Water',
    sample_fraction     TEXT,               -- Dissolved, Total, etc.
    provider            TEXT DEFAULT 'WQP',
    organization        TEXT,
    UNIQUE (time, site_id, parameter, sample_fraction)
);

SELECT create_hypertable('water_quality', by_range('time'));

CREATE INDEX IF NOT EXISTS idx_wq_site ON water_quality (site_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_wq_param ON water_quality (parameter, time DESC);
CREATE INDEX IF NOT EXISTS idx_wq_geom ON water_quality USING GIST (geom);
