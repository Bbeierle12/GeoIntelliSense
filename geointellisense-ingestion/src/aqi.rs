use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct Station {
    pub id: Uuid,
    pub name: String,
    pub lat: f64,
    pub lng: f64,
    pub county: String,
    pub base_aqi: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AqiReading {
    pub station_id: Uuid,
    pub station_name: String,
    pub lat: f64,
    pub lng: f64,
    pub county: String,
    pub timestamp: DateTime<Utc>,
    pub aqi: u32,
    pub category: &'static str,
    pub color: &'static str,
    pub pm25: f64,
    // Everything below is optional: a field is present only when it was
    // actually measured. Serialising an unmeasured pollutant as 0.0 made the
    // UI display a hard zero that looked like a real reading.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pm10: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub o3: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub so2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub co: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub humidity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wind_speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wind_direction: Option<f64>,
    pub source: &'static str,
    /// Which correction was applied to `pm25`, if any, so a consumer can tell a
    /// corrected sensor value from a raw one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correction: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_sensor_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AqiHistoryPoint {
    pub timestamp: DateTime<Utc>,
    pub aqi: u32,
    pub pm25: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pm10: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub o3: Option<f64>,
    /// Where the point came from, so a chart can never present stored
    /// measurements and generated values as the same thing.
    pub source: &'static str,
}

/// Kern County reporting communities.
///
/// Scope is Kern County only. Each entry is a community that had live outdoor
/// PurpleAir coverage when this list was compiled (2026-09-09); communities with
/// no sensors (Arvin/Lamont, Frazier Park, Buttonwillow) are deliberately absent
/// rather than present-but-empty. Sensors are assigned to the nearest station
/// and anything farther than `purpleair::MAX_STATION_RADIUS_KM` is discarded, so
/// the list also acts as the county boundary filter.
pub fn stations() -> Vec<Station> {
    vec![
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000002").unwrap(),
            name: "Bakersfield".into(), lat: 35.3733, lng: -119.0187,
            county: "Kern".into(), base_aqi: 85.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000011").unwrap(),
            name: "Delano".into(), lat: 35.7688, lng: -119.2471,
            county: "Kern".into(), base_aqi: 75.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000012").unwrap(),
            name: "Shafter-Wasco".into(), lat: 35.5300, lng: -119.3000,
            county: "Kern".into(), base_aqi: 78.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000013").unwrap(),
            name: "Taft".into(), lat: 35.1425, lng: -119.4565,
            county: "Kern".into(), base_aqi: 70.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000015").unwrap(),
            name: "Tehachapi".into(), lat: 35.1322, lng: -118.4490,
            county: "Kern".into(), base_aqi: 45.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000016").unwrap(),
            name: "Ridgecrest".into(), lat: 35.6225, lng: -117.6709,
            county: "Kern".into(), base_aqi: 45.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000017").unwrap(),
            name: "Lake Isabella".into(), lat: 35.6180, lng: -118.4730,
            county: "Kern".into(), base_aqi: 40.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000018").unwrap(),
            name: "California City".into(), lat: 35.1258, lng: -117.9859,
            county: "Kern".into(), base_aqi: 40.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0002-4000-8000-000000000019").unwrap(),
            name: "Mojave-Rosamond".into(), lat: 34.9500, lng: -118.1700,
            county: "Kern".into(), base_aqi: 42.0,
        },
    ]
}

pub fn aqi_category(aqi: u32) -> (&'static str, &'static str) {
    match aqi {
        0..=50 => ("Good", "#00e400"),
        51..=100 => ("Moderate", "#ffff00"),
        101..=150 => ("Unhealthy for Sensitive Groups", "#ff7e00"),
        151..=200 => ("Unhealthy", "#ff0000"),
        201..=300 => ("Very Unhealthy", "#8f3f97"),
        _ => ("Hazardous", "#7e0023"),
    }
}

// generate_readings() and generate_history() were removed. They produced
// random values that were persisted to sensor_readings, broadcast over SSE,
// and charted, in every case without anything marking them as synthetic.

pub fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
