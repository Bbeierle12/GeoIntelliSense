use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

use crate::aqi::{aqi_category, round2, AqiReading, Station};

// SJV bounding box
const NW_LAT: f64 = 38.0;
const SE_LAT: f64 = 35.0;
const NW_LNG: f64 = -121.5;
const SE_LNG: f64 = -118.5;

const PURPLEAIR_URL: &str = "https://api.purpleair.com/v1/sensors";

// Fields we request from PurpleAir
const FIELDS: &str = "name,latitude,longitude,pm2.5,pm10.0,ozone1,humidity,temperature,pressure";

#[derive(Debug, Deserialize)]
struct PurpleAirResponse {
    fields: Vec<String>,
    data: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug)]
struct RawSensor {
    name: String,
    lat: f64,
    lng: f64,
    pm25: f64,
    pm10: f64,
    ozone: f64,
    humidity: f64,
    temperature: f64,
}

pub struct PurpleAirClient {
    api_key: String,
    http: reqwest::Client,
}

impl PurpleAirClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            http: reqwest::Client::new(),
        }
    }

    /// Fetch SJV sensors and aggregate to nearest seeded station.
    /// Returns one `AqiReading` per station, averaging all PurpleAir sensors
    /// within closest proximity.
    pub async fn fetch_readings(&self, stations: &[Station]) -> Result<Vec<AqiReading>, PurpleAirError> {
        let sensors = self.fetch_sensors().await?;

        if sensors.is_empty() {
            return Err(PurpleAirError::NoSensors);
        }

        tracing::info!("PurpleAir: {} sensors in SJV bounding box", sensors.len());

        // Bucket each sensor to its nearest seeded station
        let mut buckets: std::collections::HashMap<Uuid, Vec<&RawSensor>> =
            stations.iter().map(|s| (s.id, Vec::new())).collect();

        for sensor in &sensors {
            let nearest = stations
                .iter()
                .min_by(|a, b| {
                    let da = haversine_sq(sensor.lat, sensor.lng, a.lat, a.lng);
                    let db = haversine_sq(sensor.lat, sensor.lng, b.lat, b.lng);
                    da.partial_cmp(&db).unwrap()
                })
                .unwrap();
            buckets.get_mut(&nearest.id).unwrap().push(sensor);
        }

        let now = Utc::now();
        let mut readings = Vec::with_capacity(stations.len());

        for station in stations {
            let bucket = &buckets[&station.id];

            if bucket.is_empty() {
                // No PurpleAir sensors near this station — skip, caller can
                // fill in with mock data.
                continue;
            }

            let count = bucket.len();
            let n = count as f64;
            let pm25 = round2(bucket.iter().map(|s| s.pm25).sum::<f64>() / n);
            let pm10 = round2(bucket.iter().map(|s| s.pm10).sum::<f64>() / n);
            let ozone = round2(bucket.iter().map(|s| s.ozone).sum::<f64>() / n);
            let humidity = round2(bucket.iter().map(|s| s.humidity).sum::<f64>() / n);
            let temperature = round2(bucket.iter().map(|s| s.temperature).sum::<f64>() / n);

            let aqi = pm25_to_aqi(pm25);
            let (category, color) = aqi_category(aqi);

            readings.push(AqiReading {
                station_id: station.id,
                station_name: station.name.clone(),
                lat: station.lat,
                lng: station.lng,
                county: station.county.clone(),
                timestamp: now,
                aqi,
                category,
                color,
                pm25,
                pm10,
                o3: ozone,
                no2: 0.0,  // PurpleAir doesn't provide NO2
                so2: 0.0,  // PurpleAir doesn't provide SO2
                co: 0.0,   // PurpleAir doesn't provide CO
                temperature,
                humidity,
                wind_speed: 0.0,      // PurpleAir doesn't provide wind
                wind_direction: 0.0,
                source: "purpleair",
                raw_sensor_count: Some(count as i32),
            });
        }

        Ok(readings)
    }

    async fn fetch_sensors(&self) -> Result<Vec<RawSensor>, PurpleAirError> {
        let resp = self
            .http
            .get(PURPLEAIR_URL)
            .header("X-API-Key", &self.api_key)
            .query(&[
                ("fields", FIELDS),
                ("location_type", "0"),  // outdoor sensors only
                ("nwlat", &NW_LAT.to_string()),
                ("nwlng", &NW_LNG.to_string()),
                ("selat", &SE_LAT.to_string()),
                ("selng", &SE_LNG.to_string()),
            ])
            .send()
            .await
            .map_err(PurpleAirError::Http)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(PurpleAirError::Api(status.as_u16(), body));
        }

        let body: PurpleAirResponse = resp.json().await.map_err(PurpleAirError::Http)?;
        let sensors = parse_response(&body);
        Ok(sensors)
    }
}

fn parse_response(resp: &PurpleAirResponse) -> Vec<RawSensor> {
    // Build field index map
    let idx = |name: &str| -> Option<usize> { resp.fields.iter().position(|f| f == name) };

    let i_name = idx("name");
    let i_lat = idx("latitude");
    let i_lng = idx("longitude");
    let i_pm25 = idx("pm2.5");
    let i_pm10 = idx("pm10.0");
    let i_ozone = idx("ozone1");
    let i_hum = idx("humidity");
    let i_temp = idx("temperature");

    resp.data
        .iter()
        .filter_map(|row| {
            let name = i_name.and_then(|i| row.get(i)?.as_str()).unwrap_or("").to_string();
            let lat = i_lat.and_then(|i| row.get(i)?.as_f64())?;
            let lng = i_lng.and_then(|i| row.get(i)?.as_f64())?;
            let pm25 = i_pm25.and_then(|i| row.get(i)?.as_f64()).unwrap_or(0.0);
            let pm10 = i_pm10.and_then(|i| row.get(i)?.as_f64()).unwrap_or(0.0);
            let ozone = i_ozone.and_then(|i| row.get(i)?.as_f64()).unwrap_or(0.0);
            let humidity = i_hum.and_then(|i| row.get(i)?.as_f64()).unwrap_or(0.0);
            let temperature = i_temp.and_then(|i| row.get(i)?.as_f64()).unwrap_or(0.0);

            // Skip sensors with clearly bad data
            if pm25 < 0.0 || pm25 > 1000.0 {
                return None;
            }

            Some(RawSensor {
                name,
                lat,
                lng,
                pm25,
                pm10,
                ozone,
                humidity,
                temperature,
            })
        })
        .collect()
}

/// EPA PM2.5 AQI breakpoint conversion
fn pm25_to_aqi(pm25: f64) -> u32 {
    let aqi = if pm25 <= 12.0 {
        linear(0.0, 50.0, 0.0, 12.0, pm25)
    } else if pm25 <= 35.4 {
        linear(51.0, 100.0, 12.1, 35.4, pm25)
    } else if pm25 <= 55.4 {
        linear(101.0, 150.0, 35.5, 55.4, pm25)
    } else if pm25 <= 150.4 {
        linear(151.0, 200.0, 55.5, 150.4, pm25)
    } else if pm25 <= 250.4 {
        linear(201.0, 300.0, 150.5, 250.4, pm25)
    } else if pm25 <= 500.4 {
        linear(301.0, 500.0, 250.5, 500.4, pm25)
    } else {
        500.0
    };
    aqi.round() as u32
}

fn linear(aqi_lo: f64, aqi_hi: f64, conc_lo: f64, conc_hi: f64, conc: f64) -> f64 {
    (aqi_hi - aqi_lo) / (conc_hi - conc_lo) * (conc - conc_lo) + aqi_lo
}

/// Squared distance approximation (good enough for nearest-neighbor within SJV)
fn haversine_sq(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let dlat = lat2 - lat1;
    let dlng = (lng2 - lng1) * 0.8; // rough cos(37°) correction
    dlat * dlat + dlng * dlng
}

#[derive(Debug)]
pub enum PurpleAirError {
    Http(reqwest::Error),
    Api(u16, String),
    NoSensors,
}

impl std::fmt::Display for PurpleAirError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(e) => write!(f, "PurpleAir HTTP error: {e}"),
            Self::Api(code, body) => write!(f, "PurpleAir API {code}: {body}"),
            Self::NoSensors => write!(f, "No PurpleAir sensors found in SJV"),
        }
    }
}
