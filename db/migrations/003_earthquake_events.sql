CREATE TABLE IF NOT EXISTS earthquake_events (
    time        TIMESTAMPTZ NOT NULL,
    event_id    TEXT NOT NULL,
    magnitude   DOUBLE PRECISION NOT NULL,
    depth_km    DOUBLE PRECISION,
    geom        GEOMETRY(Point, 4326) NOT NULL,
    place       TEXT,
    felt        INTEGER,
    tsunami     BOOLEAN DEFAULT false,
    alert       TEXT,
    status      TEXT,
    source      TEXT
);

SELECT create_hypertable('earthquake_events', by_range('time'));

CREATE INDEX idx_earthquake_geom ON earthquake_events USING GIST (geom);
CREATE UNIQUE INDEX idx_earthquake_event_id ON earthquake_events (event_id, time);
CREATE INDEX idx_earthquake_magnitude ON earthquake_events (magnitude DESC, time DESC);
