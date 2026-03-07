CREATE TABLE IF NOT EXISTS sensor_readings (
    time            TIMESTAMPTZ NOT NULL,
    location_id     UUID NOT NULL REFERENCES locations(id),
    pm25            DOUBLE PRECISION,
    pm10            DOUBLE PRECISION,
    o3              DOUBLE PRECISION,
    no2             DOUBLE PRECISION,
    so2             DOUBLE PRECISION,
    co              DOUBLE PRECISION,
    aqi             INTEGER,
    temperature     DOUBLE PRECISION,
    humidity        DOUBLE PRECISION,
    wind_speed      DOUBLE PRECISION,
    wind_direction  DOUBLE PRECISION
);

SELECT create_hypertable('sensor_readings', by_range('time'));

CREATE INDEX idx_sensor_readings_location ON sensor_readings (location_id, time DESC);
