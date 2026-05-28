-- Temperature inversion detection log
CREATE TABLE IF NOT EXISTS inversion_events (
    time                TIMESTAMPTZ NOT NULL,
    surface_temp_c      DOUBLE PRECISION,
    temp_850mb_c        DOUBLE PRECISION,
    temp_diff_c         DOUBLE PRECISION,     -- 850mb minus surface (positive = inversion)
    surface_dewpoint_c  DOUBLE PRECISION,
    wind_speed_kts      DOUBLE PRECISION,
    mixing_height_m     DOUBLE PRECISION,
    inversion_strength  TEXT,                  -- none, weak, moderate, strong
    fog_likely          BOOLEAN DEFAULT FALSE,
    source              TEXT DEFAULT 'nws_sounding',
    sounding_station    TEXT DEFAULT 'VBG'     -- Vandenberg AFB (nearest SJV upper-air)
);

SELECT create_hypertable('inversion_events', by_range('time'));

CREATE INDEX IF NOT EXISTS idx_inversion_time ON inversion_events (time DESC);
CREATE INDEX IF NOT EXISTS idx_inversion_strength ON inversion_events (inversion_strength, time DESC);
