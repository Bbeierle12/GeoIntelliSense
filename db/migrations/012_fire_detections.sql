CREATE TABLE IF NOT EXISTS fire_detections (
    time            TIMESTAMPTZ NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    geom            GEOMETRY(Point, 4326) NOT NULL,
    brightness      DOUBLE PRECISION,
    frp             DOUBLE PRECISION,
    confidence      TEXT,
    satellite       TEXT,
    instrument      TEXT,
    daynight        TEXT,
    source          TEXT NOT NULL DEFAULT 'firms'
);

SELECT create_hypertable('fire_detections', by_range('time'));

CREATE INDEX idx_fire_geom ON fire_detections USING GIST (geom);
CREATE INDEX idx_fire_time ON fire_detections (time DESC);
CREATE INDEX idx_fire_confidence ON fire_detections (confidence, time DESC);
