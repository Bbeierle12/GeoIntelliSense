ALTER TABLE sensor_readings
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'mock',
    ADD COLUMN IF NOT EXISTS raw_sensor_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_sensor_readings_source ON sensor_readings (source, time DESC);
