-- Hourly comparison of our sensor-derived PM2.5 index against the EPA
-- reference for the same community.
--
-- The dashboard drifted to reporting AQI 10 against a published 77 and nothing
-- in the system noticed. This table makes that divergence queryable: if the
-- sensor index and the AirNow PM2.5 sub-index separate persistently, either the
-- correction, the bucketing or the sensor population has a problem.

CREATE TABLE IF NOT EXISTS aqi_validation (
    time              TIMESTAMPTZ NOT NULL,
    community         TEXT NOT NULL,
    reporting_area    TEXT,
    sensor_pm25       DOUBLE PRECISION,
    sensor_pm25_aqi   INTEGER,
    sensor_count      INTEGER,
    airnow_pm25_aqi   INTEGER,
    airnow_aqi        INTEGER,
    airnow_dominant   TEXT,
    -- sensor_pm25_aqi - airnow_pm25_aqi; positive means we read higher.
    delta_pm25_aqi    INTEGER
);

SELECT create_hypertable('aqi_validation', by_range('time'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_aqi_validation_community
    ON aqi_validation (community, time DESC);
