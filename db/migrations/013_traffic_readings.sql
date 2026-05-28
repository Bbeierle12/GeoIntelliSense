CREATE TABLE IF NOT EXISTS traffic_readings (
    route           TEXT NOT NULL,
    postmile        DOUBLE PRECISION,
    description     TEXT,
    county          TEXT,
    ahead_aadt      INTEGER,
    ahead_peak_hour INTEGER,
    back_aadt       INTEGER,
    geom            GEOMETRY(MultiLineString, 4326),
    source          TEXT NOT NULL DEFAULT 'caltrans_aadt',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_route_pm
    ON traffic_readings (route, postmile, description);
CREATE INDEX IF NOT EXISTS idx_traffic_geom ON traffic_readings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_traffic_route ON traffic_readings (route);
CREATE INDEX IF NOT EXISTS idx_traffic_county ON traffic_readings (county);
