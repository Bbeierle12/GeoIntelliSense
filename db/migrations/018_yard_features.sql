CREATE TABLE IF NOT EXISTS yard_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    geom GEOMETRY(Polygon, 4326),
    vertices JSONB NOT NULL,
    area_sqft DOUBLE PRECISION NOT NULL,
    area_sqm DOUBLE PRECISION NOT NULL,
    perimeter_ft DOUBLE PRECISION,
    measurement_type TEXT NOT NULL CHECK (measurement_type IN ('map', 'manual', 'ar')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_geom CHECK (measurement_type = 'manual' OR measurement_type = 'ar' OR geom IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_yard_features_geom ON yard_features USING GIST (geom);
