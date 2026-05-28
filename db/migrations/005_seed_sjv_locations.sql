INSERT INTO locations (id, name, geom, county, elevation) VALUES
    ('a1b2c3d4-0001-4000-8000-000000000001', 'Fresno-Garland',        ST_SetSRID(ST_MakePoint(-119.7871, 36.7852), 4326), 'Fresno',  94.0),
    ('a1b2c3d4-0001-4000-8000-000000000002', 'Bakersfield-California', ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326), 'Kern',    124.0),
    ('a1b2c3d4-0001-4000-8000-000000000003', 'Stockton-Hazelton',     ST_SetSRID(ST_MakePoint(-121.2908, 37.9505), 4326), 'San Joaquin', 7.0),
    ('a1b2c3d4-0001-4000-8000-000000000004', 'Modesto-14th Street',   ST_SetSRID(ST_MakePoint(-120.9969, 37.6391), 4326), 'Stanislaus', 27.0),
    ('a1b2c3d4-0001-4000-8000-000000000005', 'Visalia-Church',        ST_SetSRID(ST_MakePoint(-119.2921, 36.3302), 4326), 'Tulare',  100.0),
    ('a1b2c3d4-0001-4000-8000-000000000006', 'Merced-Coffee',         ST_SetSRID(ST_MakePoint(-120.4630, 37.2827), 4326), 'Merced',  52.0)
ON CONFLICT (id) DO NOTHING;
