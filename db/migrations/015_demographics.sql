-- Census ACS 5-year demographic estimates by tract
CREATE TABLE IF NOT EXISTS demographics (
    geoid TEXT PRIMARY KEY,
    acs_year INTEGER NOT NULL,
    total_population INTEGER,
    median_household_income INTEGER,
    per_capita_income INTEGER,
    poverty_rate DOUBLE PRECISION,
    poverty_count INTEGER,
    -- Race / ethnicity
    white_alone INTEGER,
    black_alone INTEGER,
    aian_alone INTEGER,
    asian_alone INTEGER,
    nhpi_alone INTEGER,
    other_alone INTEGER,
    two_or_more INTEGER,
    hispanic_latino INTEGER,
    white_non_hispanic INTEGER,
    -- Linguistic isolation
    limited_english_hh INTEGER,
    total_households INTEGER,
    linguistic_isolation_pct DOUBLE PRECISION,
    -- Education (pop 25+)
    pop_25_plus INTEGER,
    less_than_hs INTEGER,
    hs_diploma INTEGER,
    some_college INTEGER,
    bachelors_plus INTEGER,
    education_less_than_hs_pct DOUBLE PRECISION,
    education_bachelors_plus_pct DOUBLE PRECISION,
    -- Age
    median_age DOUBLE PRECISION,
    under_18 INTEGER,
    over_65 INTEGER,
    -- Housing
    owner_occupied INTEGER,
    renter_occupied INTEGER,
    median_rent INTEGER,
    median_home_value INTEGER,
    -- Metadata
    source TEXT DEFAULT 'acs5',
    fetched_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demographics_year ON demographics (acs_year);
