ALTER TABLE wells ADD COLUMN IF NOT EXISTS operator TEXT;
ALTER TABLE wells ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'calgem';
CREATE INDEX IF NOT EXISTS idx_wells_county ON wells (county);
CREATE INDEX IF NOT EXISTS idx_wells_status ON wells (status);
