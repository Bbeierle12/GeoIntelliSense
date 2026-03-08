"""
U.S. Census Bureau ACS 5-Year Estimates client.

Pulls demographic data for Kern County census tracts.
API docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
No rate limit auth required, but an API key removes throttling.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

ACS_BASE = "https://api.census.gov/data"

# Kern County FIPS: state=06, county=029
KERN_STATE = "06"
KERN_COUNTY = "029"

# SJV county FIPS codes
SJV_COUNTIES = {
    "029": "Kern",
    "019": "Fresno",
    "107": "Tulare",
    "031": "Kings",
    "047": "Merced",
    "077": "San Joaquin",
    "099": "Stanislaus",
    "039": "Madera",
}

# ACS 5-year variables we need
# B01003_001E = total population
# B19013_001E = median household income
# B19301_001E = per capita income
# B17001_002E = population below poverty
# B02001_002E-008E = race categories
# B03003_003E = hispanic/latino
# B02001_002E minus B03002_003E approach, or use B03002_003E for white non-hispanic
# C16002_001E = total households (linguistic isolation table)
# C16002_004E + C16002_007E + C16002_010E + C16002_013E = limited English HH
# B15003 = educational attainment (25+)
# B01002_001E = median age
# B09001_001E = under 18 (or B01001 breakdown)
# B01001 age breakdowns for 65+
# B25003_002E = owner occupied, B25003_003E = renter occupied
# B25064_001E = median rent
# B25077_001E = median home value

VARIABLES = [
    "B01003_001E",   # total population
    "B19013_001E",   # median household income
    "B19301_001E",   # per capita income
    "B17001_001E",   # poverty universe
    "B17001_002E",   # below poverty
    # Race
    "B02001_002E",   # white alone
    "B02001_003E",   # black alone
    "B02001_004E",   # AIAN alone
    "B02001_005E",   # asian alone
    "B02001_006E",   # NHPI alone
    "B02001_007E",   # some other race
    "B02001_008E",   # two or more
    "B03003_003E",   # hispanic/latino
    "B03002_003E",   # white non-hispanic
    # Linguistic isolation
    "C16002_001E",   # total households
    "C16002_004E",   # spanish limited english HH
    "C16002_007E",   # indo-european limited english HH
    "C16002_010E",   # asian/pacific limited english HH
    "C16002_013E",   # other limited english HH
    # Education (25+)
    "B15003_001E",   # total 25+
    "B15003_002E",   # no schooling
    "B15003_003E",   # nursery
    "B15003_004E",   # kindergarten
    "B15003_005E",   # 1st grade
    "B15003_006E",   # 2nd grade
    "B15003_007E",   # 3rd grade
    "B15003_008E",   # 4th grade
    "B15003_009E",   # 5th grade
    "B15003_010E",   # 6th grade
    "B15003_011E",   # 7th grade
    "B15003_012E",   # 8th grade
    "B15003_013E",   # 9th grade
    "B15003_014E",   # 10th grade
    "B15003_015E",   # 11th grade
    "B15003_016E",   # 12th no diploma
    "B15003_017E",   # HS diploma
    "B15003_018E",   # GED
    "B15003_019E",   # some college <1yr
    "B15003_020E",   # some college 1+yr
    "B15003_021E",   # associate's
    "B15003_022E",   # bachelor's
    "B15003_023E",   # master's
    "B15003_024E",   # professional
    "B15003_025E",   # doctorate
    # Age
    "B01002_001E",   # median age
    "B09001_001E",   # under 18
    # 65+ (male + female from B01001)
    "B01001_020E", "B01001_021E", "B01001_022E", "B01001_023E", "B01001_024E", "B01001_025E",  # male 65+
    "B01001_044E", "B01001_045E", "B01001_046E", "B01001_047E", "B01001_048E", "B01001_049E",  # female 65+
    # Housing
    "B25003_002E",   # owner occupied
    "B25003_003E",   # renter occupied
    "B25064_001E",   # median rent
    "B25077_001E",   # median home value
]


@dataclass
class TractDemographics:
    geoid: str
    acs_year: int
    total_population: int | None = None
    median_household_income: int | None = None
    per_capita_income: int | None = None
    poverty_rate: float | None = None
    poverty_count: int | None = None
    white_alone: int | None = None
    black_alone: int | None = None
    aian_alone: int | None = None
    asian_alone: int | None = None
    nhpi_alone: int | None = None
    other_alone: int | None = None
    two_or_more: int | None = None
    hispanic_latino: int | None = None
    white_non_hispanic: int | None = None
    limited_english_hh: int | None = None
    total_households: int | None = None
    linguistic_isolation_pct: float | None = None
    pop_25_plus: int | None = None
    less_than_hs: int | None = None
    hs_diploma: int | None = None
    some_college: int | None = None
    bachelors_plus: int | None = None
    education_less_than_hs_pct: float | None = None
    education_bachelors_plus_pct: float | None = None
    median_age: float | None = None
    under_18: int | None = None
    over_65: int | None = None
    owner_occupied: int | None = None
    renter_occupied: int | None = None
    median_rent: int | None = None
    median_home_value: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "geoid": self.geoid,
            "acsYear": self.acs_year,
            "totalPopulation": self.total_population,
            "medianHouseholdIncome": self.median_household_income,
            "perCapitaIncome": self.per_capita_income,
            "povertyRate": self.poverty_rate,
            "povertyCount": self.poverty_count,
            "race": {
                "whiteAlone": self.white_alone,
                "blackAlone": self.black_alone,
                "aianAlone": self.aian_alone,
                "asianAlone": self.asian_alone,
                "nhpiAlone": self.nhpi_alone,
                "otherAlone": self.other_alone,
                "twoOrMore": self.two_or_more,
                "hispanicLatino": self.hispanic_latino,
                "whiteNonHispanic": self.white_non_hispanic,
            },
            "linguisticIsolation": {
                "limitedEnglishHouseholds": self.limited_english_hh,
                "totalHouseholds": self.total_households,
                "pct": self.linguistic_isolation_pct,
            },
            "education": {
                "pop25Plus": self.pop_25_plus,
                "lessThanHS": self.less_than_hs,
                "hsDiploma": self.hs_diploma,
                "someCollege": self.some_college,
                "bachelorsPlus": self.bachelors_plus,
                "lessThanHSPct": self.education_less_than_hs_pct,
                "bachelorsPlusPct": self.education_bachelors_plus_pct,
            },
            "age": {
                "medianAge": self.median_age,
                "under18": self.under_18,
                "over65": self.over_65,
            },
            "housing": {
                "ownerOccupied": self.owner_occupied,
                "renterOccupied": self.renter_occupied,
                "medianRent": self.median_rent,
                "medianHomeValue": self.median_home_value,
            },
        }


def _safe_int(val) -> int | None:
    if val is None:
        return None
    try:
        v = int(val)
        return None if v < 0 else v  # Census uses negative values for missing
    except (ValueError, TypeError):
        return None


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        v = float(val)
        return None if v < 0 else v
    except (ValueError, TypeError):
        return None


def _parse_row(row: dict[str, str], year: int, state: str, county: str, tract: str) -> TractDemographics:
    geoid = f"{state}{county}{tract}"

    total_pop = _safe_int(row.get("B01003_001E"))
    poverty_universe = _safe_int(row.get("B17001_001E"))
    poverty_count = _safe_int(row.get("B17001_002E"))
    poverty_rate = None
    if poverty_universe and poverty_count is not None:
        poverty_rate = round(poverty_count / poverty_universe * 100, 1) if poverty_universe > 0 else None

    # Linguistic isolation: sum of limited-English households
    le_spanish = _safe_int(row.get("C16002_004E")) or 0
    le_indo = _safe_int(row.get("C16002_007E")) or 0
    le_asian = _safe_int(row.get("C16002_010E")) or 0
    le_other = _safe_int(row.get("C16002_013E")) or 0
    limited_english = le_spanish + le_indo + le_asian + le_other
    total_hh = _safe_int(row.get("C16002_001E"))
    ling_pct = None
    if total_hh and total_hh > 0:
        ling_pct = round(limited_english / total_hh * 100, 1)

    # Education: less than HS = B15003_002 through _016
    pop_25 = _safe_int(row.get("B15003_001E"))
    less_hs = sum(_safe_int(row.get(f"B15003_{i:03d}E")) or 0 for i in range(2, 17))
    hs_diploma = (_safe_int(row.get("B15003_017E")) or 0) + (_safe_int(row.get("B15003_018E")) or 0)
    some_college = sum(_safe_int(row.get(f"B15003_{i:03d}E")) or 0 for i in range(19, 22))
    bachelors_plus = sum(_safe_int(row.get(f"B15003_{i:03d}E")) or 0 for i in range(22, 26))

    ed_less_hs_pct = round(less_hs / pop_25 * 100, 1) if pop_25 and pop_25 > 0 else None
    ed_bach_pct = round(bachelors_plus / pop_25 * 100, 1) if pop_25 and pop_25 > 0 else None

    # Over 65: male (020-025) + female (044-049)
    over_65 = sum(
        _safe_int(row.get(f"B01001_{i:03d}E")) or 0
        for i in list(range(20, 26)) + list(range(44, 50))
    )

    return TractDemographics(
        geoid=geoid,
        acs_year=year,
        total_population=total_pop,
        median_household_income=_safe_int(row.get("B19013_001E")),
        per_capita_income=_safe_int(row.get("B19301_001E")),
        poverty_rate=poverty_rate,
        poverty_count=poverty_count,
        white_alone=_safe_int(row.get("B02001_002E")),
        black_alone=_safe_int(row.get("B02001_003E")),
        aian_alone=_safe_int(row.get("B02001_004E")),
        asian_alone=_safe_int(row.get("B02001_005E")),
        nhpi_alone=_safe_int(row.get("B02001_006E")),
        other_alone=_safe_int(row.get("B02001_007E")),
        two_or_more=_safe_int(row.get("B02001_008E")),
        hispanic_latino=_safe_int(row.get("B03003_003E")),
        white_non_hispanic=_safe_int(row.get("B03002_003E")),
        limited_english_hh=limited_english if limited_english > 0 else None,
        total_households=total_hh,
        linguistic_isolation_pct=ling_pct,
        pop_25_plus=pop_25,
        less_than_hs=less_hs if less_hs > 0 else None,
        hs_diploma=hs_diploma if hs_diploma > 0 else None,
        some_college=some_college if some_college > 0 else None,
        bachelors_plus=bachelors_plus if bachelors_plus > 0 else None,
        education_less_than_hs_pct=ed_less_hs_pct,
        education_bachelors_plus_pct=ed_bach_pct,
        median_age=_safe_float(row.get("B01002_001E")),
        under_18=_safe_int(row.get("B09001_001E")),
        over_65=over_65 if over_65 > 0 else None,
        owner_occupied=_safe_int(row.get("B25003_002E")),
        renter_occupied=_safe_int(row.get("B25003_003E")),
        median_rent=_safe_int(row.get("B25064_001E")),
        median_home_value=_safe_int(row.get("B25077_001E")),
    )


async def fetch_tract_demographics(
    api_key: str | None = None,
    state: str = KERN_STATE,
    county: str = KERN_COUNTY,
    year: int = 2022,
) -> list[TractDemographics]:
    """Fetch ACS 5-year tract-level demographics for a county."""

    # Census API allows max ~50 variables per request, we need to split
    var_chunks = [VARIABLES[i:i + 48] for i in range(0, len(VARIABLES), 48)]

    all_data: dict[str, dict[str, str]] = {}  # tract → {var: value}

    async with httpx.AsyncClient(timeout=30.0) as client:
        for chunk in var_chunks:
            var_str = ",".join(chunk)
            url = f"{ACS_BASE}/{year}/acs/acs5"
            params: dict[str, str] = {
                "get": var_str,
                "for": "tract:*",
                "in": f"state:{state} county:{county}",
            }
            if api_key:
                params["key"] = api_key

            resp = await client.get(url, params=params)
            resp.raise_for_status()

            data = resp.json()
            headers = data[0]

            for row in data[1:]:
                row_dict = dict(zip(headers, row))
                tract = row_dict.get("tract", "")
                if tract not in all_data:
                    all_data[tract] = {}
                all_data[tract].update(row_dict)

    results = []
    for tract, row_data in all_data.items():
        results.append(_parse_row(row_data, year, state, county, tract))

    logger.info("Census ACS: %d tracts fetched for state=%s county=%s year=%d", len(results), state, county, year)
    return results


async def fetch_sjv_demographics(
    api_key: str | None = None,
    year: int = 2022,
) -> list[TractDemographics]:
    """Fetch demographics for all SJV counties."""
    all_tracts: list[TractDemographics] = []
    for county_fips in SJV_COUNTIES:
        tracts = await fetch_tract_demographics(api_key, KERN_STATE, county_fips, year)
        all_tracts.extend(tracts)
    return all_tracts
