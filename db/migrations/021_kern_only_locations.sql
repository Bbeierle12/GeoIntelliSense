-- Narrow the platform's scope to Kern County (September 2026).
--
-- The original seed covered six San Joaquin Valley cities spread over 300 km.
-- Averaging across that span produced a headline number no public source
-- reports, and the PurpleAir bucketing that fed it reached as far as the
-- Central Coast. Scope is now Kern County only.

-- 1. Kern communities that have live outdoor PurpleAir coverage.
--    Bakersfield keeps its original UUID so its history is preserved.
INSERT INTO locations (id, name, geom, county, elevation) VALUES
    ('a1b2c3d4-0002-4000-8000-000000000011', 'Delano',
        ST_SetSRID(ST_MakePoint(-119.2471, 35.7688), 4326), 'Kern',   96.0),
    ('a1b2c3d4-0002-4000-8000-000000000012', 'Shafter-Wasco',
        ST_SetSRID(ST_MakePoint(-119.3000, 35.5300), 4326), 'Kern',  107.0),
    ('a1b2c3d4-0002-4000-8000-000000000013', 'Taft',
        ST_SetSRID(ST_MakePoint(-119.4565, 35.1425), 4326), 'Kern',  290.0),
    ('a1b2c3d4-0002-4000-8000-000000000015', 'Tehachapi',
        ST_SetSRID(ST_MakePoint(-118.4490, 35.1322), 4326), 'Kern', 1210.0),
    ('a1b2c3d4-0002-4000-8000-000000000016', 'Ridgecrest',
        ST_SetSRID(ST_MakePoint(-117.6709, 35.6225), 4326), 'Kern',  698.0),
    ('a1b2c3d4-0002-4000-8000-000000000017', 'Lake Isabella',
        ST_SetSRID(ST_MakePoint(-118.4730, 35.6180), 4326), 'Kern',  794.0),
    ('a1b2c3d4-0002-4000-8000-000000000018', 'California City',
        ST_SetSRID(ST_MakePoint(-117.9859, 35.1258), 4326), 'Kern',  732.0),
    ('a1b2c3d4-0002-4000-8000-000000000019', 'Mojave-Rosamond',
        ST_SetSRID(ST_MakePoint(-118.1700, 34.9500), 4326), 'Kern',  785.0)
ON CONFLICT (id) DO NOTHING;

-- 2. The station is the community, not one monitor site on California Ave.
UPDATE locations
   SET name = 'Bakersfield', updated_at = now()
 WHERE id = 'a1b2c3d4-0001-4000-8000-000000000002';

-- 3. Drop the five non-Kern cities. Their stored readings are deleted with
--    them: every row was either mock data or a PurpleAir average computed over
--    the pre-fix bucketing, so none of it is worth keeping. sensor_readings
--    has a NOT NULL foreign key to locations, so readings must go first.
DELETE FROM sensor_readings
 WHERE location_id IN (
    'a1b2c3d4-0001-4000-8000-000000000001',  -- Fresno-Garland
    'a1b2c3d4-0001-4000-8000-000000000003',  -- Stockton-Hazelton
    'a1b2c3d4-0001-4000-8000-000000000004',  -- Modesto-14th Street
    'a1b2c3d4-0001-4000-8000-000000000005',  -- Visalia-Church
    'a1b2c3d4-0001-4000-8000-000000000006'   -- Merced-Coffee
 );

DELETE FROM locations
 WHERE id IN (
    'a1b2c3d4-0001-4000-8000-000000000001',
    'a1b2c3d4-0001-4000-8000-000000000003',
    'a1b2c3d4-0001-4000-8000-000000000004',
    'a1b2c3d4-0001-4000-8000-000000000005',
    'a1b2c3d4-0001-4000-8000-000000000006'
 );

-- 4. Bakersfield readings taken before the bucketing fix averaged sensors up to
--    250 km away and used the retired pre-2024 breakpoints, so they are not
--    comparable with anything recorded afterwards.
DELETE FROM sensor_readings
 WHERE location_id = 'a1b2c3d4-0001-4000-8000-000000000002'
   AND time < TIMESTAMPTZ '2026-09-09 19:00:00+00';
