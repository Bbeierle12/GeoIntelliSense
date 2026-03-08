CREATE TABLE IF NOT EXISTS weather_observations (
    date            DATE NOT NULL,
    station_id      TEXT NOT NULL,
    station_name    TEXT,
    parameter       TEXT NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    units           TEXT,
    quality_flag    TEXT,
    source          TEXT NOT NULL DEFAULT 'noaa_cdo'
);

SELECT create_hypertable('weather_observations', by_range('date'));

CREATE UNIQUE INDEX idx_weather_obs_unique
    ON weather_observations (date, station_id, parameter);
CREATE INDEX idx_weather_obs_station ON weather_observations (station_id, date DESC);
CREATE INDEX idx_weather_obs_param ON weather_observations (parameter, date DESC);
