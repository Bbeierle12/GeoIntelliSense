use chrono::{DateTime, Utc};
use rand::Rng;
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
    pub pm10: f64,
    pub o3: f64,
    pub no2: f64,
    pub so2: f64,
    pub co: f64,
    pub temperature: f64,
    pub humidity: f64,
    pub wind_speed: f64,
    pub wind_direction: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AqiHistoryPoint {
    pub timestamp: DateTime<Utc>,
    pub aqi: u32,
    pub pm25: f64,
    pub pm10: f64,
    pub o3: f64,
}

pub fn stations() -> Vec<Station> {
    vec![
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000001").unwrap(),
            name: "Fresno-Garland".into(), lat: 36.7852, lng: -119.7871,
            county: "Fresno".into(), base_aqi: 75.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000002").unwrap(),
            name: "Bakersfield-California".into(), lat: 35.3733, lng: -119.0187,
            county: "Kern".into(), base_aqi: 85.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000003").unwrap(),
            name: "Stockton-Hazelton".into(), lat: 37.9505, lng: -121.2908,
            county: "San Joaquin".into(), base_aqi: 55.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000004").unwrap(),
            name: "Modesto-14th Street".into(), lat: 37.6391, lng: -120.9969,
            county: "Stanislaus".into(), base_aqi: 60.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000005").unwrap(),
            name: "Visalia-Church".into(), lat: 36.3302, lng: -119.2921,
            county: "Tulare".into(), base_aqi: 65.0,
        },
        Station {
            id: Uuid::parse_str("a1b2c3d4-0001-4000-8000-000000000006").unwrap(),
            name: "Merced-Coffee".into(), lat: 37.2827, lng: -120.4630,
            county: "Merced".into(), base_aqi: 50.0,
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

pub fn generate_readings(stations: &[Station]) -> Vec<AqiReading> {
    let mut rng = rand::thread_rng();
    let now = Utc::now();

    stations
        .iter()
        .map(|s| {
            let aqi = (s.base_aqi + rng.gen_range(-20.0..25.0)).clamp(0.0, 500.0) as u32;
            let (category, color) = aqi_category(aqi);
            let pm25 = (aqi as f64 * 0.35 + rng.gen_range(-3.0..3.0)).max(0.0);
            let pm10 = (aqi as f64 * 0.55 + rng.gen_range(-5.0..5.0)).max(0.0);

            AqiReading {
                station_id: s.id,
                station_name: s.name.clone(),
                lat: s.lat,
                lng: s.lng,
                county: s.county.clone(),
                timestamp: now,
                aqi,
                category,
                color,
                pm25: round2(pm25),
                pm10: round2(pm10),
                o3: round2(rng.gen_range(0.02..0.08)),
                no2: round2(rng.gen_range(0.01..0.06)),
                so2: round2(rng.gen_range(0.001..0.015)),
                co: round2(rng.gen_range(0.1..1.5)),
                temperature: round2(rng.gen_range(60.0..95.0)),
                humidity: round2(rng.gen_range(30.0..85.0)),
                wind_speed: round2(rng.gen_range(0.0..25.0)),
                wind_direction: round2(rng.gen_range(0.0..360.0)),
            }
        })
        .collect()
}

pub fn generate_history(station_id: &str, hours: u32) -> Vec<AqiHistoryPoint> {
    let mut rng = rand::thread_rng();
    let now = Utc::now();
    let points = hours * 12; // one point per 5 minutes

    let base_aqi: f64 = if station_id.contains("0002") { 85.0 } else { 60.0 };
    let mut aqi_walk = base_aqi;

    (0..points)
        .rev()
        .map(|i| {
            aqi_walk += rng.gen_range(-5.0..5.0);
            aqi_walk = aqi_walk.clamp(5.0, 400.0);
            let aqi = aqi_walk as u32;

            AqiHistoryPoint {
                timestamp: now - chrono::Duration::minutes(i as i64 * 5),
                aqi,
                pm25: round2(aqi as f64 * 0.35 + rng.gen_range(-2.0..2.0)),
                pm10: round2(aqi as f64 * 0.55 + rng.gen_range(-3.0..3.0)),
                o3: round2(rng.gen_range(0.02..0.08)),
            }
        })
        .collect()
}

pub fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
