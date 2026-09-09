use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

use crate::aqi::{aqi_category, round2, AqiReading, Station};

// ── Kern County bounding box ────────────────────────────────────────────────
// Kern is not a rectangle, so this box is only a coarse pre-filter to keep the
// API response small. The real county filter is MAX_STATION_RADIUS_KM below:
// sensors that are not within that distance of a Kern community are discarded,
// which drops the Santa Barbara (Cuyama) and San Luis Obispo sensors that fall
// inside the box.
const NW_LAT: f64 = 35.82;
const NW_LNG: f64 = -120.20;
const SE_LAT: f64 = 34.78;
const SE_LNG: f64 = -117.60;

const PURPLEAIR_URL: &str = "https://api.purpleair.com/v1/sensors";

/// A sensor must be within this distance of a station to count toward it.
pub const MAX_STATION_RADIUS_KM: f64 = 20.0;

/// PurpleAir channel-agreement confidence (0-100). Below ~50 the two laser
/// channels disagree enough that the reading is not trustworthy.
const MIN_CONFIDENCE: i64 = 50;

/// Only consider sensors that reported within the last hour. Also passed to the
/// API as `max_age`, so stale sensors are never transferred or billed for.
const MAX_AGE_SECS: u32 = 3600;

/// Above this concentration the 60-minute ATM average diverges from CF=1 and
/// under-reports smoke, so the instantaneous CF=1 value is used instead.
const SMOKE_REGIME_UGM3: f64 = 25.0;

// Requested fields. Each field costs points per returned row, so this list is
// the minimum needed for a corrected, quality-filtered reading.
const FIELDS: &str =
    "name,latitude,longitude,confidence,humidity,pm2.5_cf_1,pm2.5_60minute";

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
    confidence: i64,
    humidity: f64,
    /// Instantaneous CF=1 mass concentration (the EPA correction's input).
    pm25_cf1: f64,
    /// 60-minute ATM average; smoother and comparable to an hourly monitor.
    pm25_60m: Option<f64>,
}

impl RawSensor {
    /// Value fed to the EPA correction. Prefers the 60-minute average because
    /// AirNow publishes hourly/NowCast values, but falls back to instantaneous
    /// CF=1 in the smoke regime where the ATM average under-reports.
    fn correction_input(&self) -> f64 {
        match self.pm25_60m {
            Some(avg) if self.pm25_cf1 < SMOKE_REGIME_UGM3 => avg,
            _ => self.pm25_cf1,
        }
    }
}

pub struct PurpleAirClient {
    api_key: String,
    http: reqwest::Client,
}

impl PurpleAirClient {
    pub fn new(api_key: String) -> Self {
        Self { api_key, http: reqwest::Client::new() }
    }

    /// Fetch Kern County sensors and aggregate them to the nearest station.
    ///
    /// Returns one `AqiReading` per station that has at least one usable sensor.
    /// Stations with no usable sensors are omitted entirely — never filled with
    /// synthetic data.
    pub async fn fetch_readings(&self, stations: &[Station]) -> Result<Vec<AqiReading>, PurpleAirError> {
        let sensors = self.fetch_sensors().await?;
        if sensors.is_empty() {
            return Err(PurpleAirError::NoSensors);
        }

        let total = sensors.len();
        let mut out_of_range = 0usize;
        let mut low_confidence = 0usize;
        let mut buckets: std::collections::HashMap<Uuid, Vec<&RawSensor>> =
            stations.iter().map(|s| (s.id, Vec::new())).collect();

        for sensor in &sensors {
            let nearest = stations.iter().min_by(|a, b| {
                let da = distance_km(sensor.lat, sensor.lng, a.lat, a.lng);
                let db = distance_km(sensor.lat, sensor.lng, b.lat, b.lng);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });
            let Some(station) = nearest else { continue };

            if distance_km(sensor.lat, sensor.lng, station.lat, station.lng) > MAX_STATION_RADIUS_KM {
                out_of_range += 1;
                continue;
            }
            if sensor.confidence < MIN_CONFIDENCE {
                low_confidence += 1;
                tracing::debug!(
                    sensor = %sensor.name,
                    confidence = sensor.confidence,
                    station = %station.name,
                    "dropped: channel confidence below threshold"
                );
                continue;
            }
            buckets.get_mut(&station.id).unwrap().push(sensor);
        }

        let now = Utc::now();
        let mut readings = Vec::with_capacity(stations.len());
        let mut unreported: Vec<&str> = Vec::new();

        for station in stations {
            let bucket = &buckets[&station.id];
            if bucket.is_empty() {
                unreported.push(&station.name);
                continue;
            }

            // Median of the per-sensor EPA-corrected values. Median rather than
            // mean so one malfunctioning sensor cannot move the community value.
            let corrected: Vec<f64> = bucket
                .iter()
                .map(|s| epa_correct(s.correction_input(), s.humidity))
                .collect();
            let pm25 = round2(median(corrected));
            let humidity = round2(median(bucket.iter().map(|s| s.humidity).collect()));

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
                // PurpleAir is a PM2.5 instrument; its PM10/gas columns are not
                // measurements, so they stay absent rather than reading zero.
                pm10: None,
                o3: None,
                no2: None,
                so2: None,
                co: None,
                temperature: None,
                humidity: Some(humidity),
                wind_speed: None,
                wind_direction: None,
                source: "purpleair",
                correction: Some("epa_barkjohn_2022"),
                raw_sensor_count: Some(bucket.len() as i32),
            });
        }

        tracing::info!(
            "PurpleAir: {} sensors in Kern box -> {} stations reported \
             ({} dropped: out of range, {} dropped: confidence < {}){}",
            total,
            readings.len(),
            out_of_range,
            low_confidence,
            MIN_CONFIDENCE,
            if unreported.is_empty() {
                String::new()
            } else {
                format!("; no usable sensors: {}", unreported.join(", "))
            }
        );

        Ok(readings)
    }

    async fn fetch_sensors(&self) -> Result<Vec<RawSensor>, PurpleAirError> {
        let resp = self
            .http
            .get(PURPLEAIR_URL)
            .header("X-API-Key", &self.api_key)
            .query(&[
                ("fields", FIELDS),
                ("location_type", "0"), // outdoor sensors only
                ("max_age", &MAX_AGE_SECS.to_string()),
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
        Ok(parse_response(&body))
    }
}

fn parse_response(resp: &PurpleAirResponse) -> Vec<RawSensor> {
    let idx = |name: &str| -> Option<usize> { resp.fields.iter().position(|f| f == name) };

    let i_name = idx("name");
    let i_lat = idx("latitude");
    let i_lng = idx("longitude");
    let i_conf = idx("confidence");
    let i_hum = idx("humidity");
    let i_cf1 = idx("pm2.5_cf_1");
    let i_60m = idx("pm2.5_60minute");

    resp.data
        .iter()
        .filter_map(|row| {
            let name = i_name.and_then(|i| row.get(i)?.as_str()).unwrap_or("").to_string();
            let lat = i_lat.and_then(|i| row.get(i)?.as_f64())?;
            let lng = i_lng.and_then(|i| row.get(i)?.as_f64())?;
            // A missing confidence is treated as unusable rather than perfect.
            let confidence = i_conf.and_then(|i| row.get(i)?.as_i64()).unwrap_or(0);
            let humidity = i_hum.and_then(|i| row.get(i)?.as_f64()).unwrap_or(0.0);
            // A missing PM2.5 reading drops the sensor; it must never become 0.0.
            let pm25_cf1 = i_cf1.and_then(|i| row.get(i)?.as_f64())?;
            let pm25_60m = i_60m.and_then(|i| row.get(i)?.as_f64());

            // Physically implausible values indicate a failed sensor.
            if !(0.0..=2000.0).contains(&pm25_cf1) {
                return None;
            }

            Some(RawSensor { name, lat, lng, confidence, humidity, pm25_cf1, pm25_60m })
        })
        .collect()
}

/// US-wide EPA correction for PurpleAir PM2.5 (Barkjohn et al. 2021, extended
/// for extreme smoke in 2022). Raw PurpleAir data over-reads regulatory
/// monitors — "in some cases by a factor of two" — so this is required before
/// the reading can be compared with AirNow.
///
/// `pa_cf1` is the CF=1 mass concentration, `rh` the sensor's relative humidity.
fn epa_correct(pa_cf1: f64, rh: f64) -> f64 {
    let low = 0.524 * pa_cf1 - 0.0862 * rh + 5.75;
    let high = pa_cf1 * pa_cf1 * 4.21e-4 + pa_cf1 * 0.392 + 3.44;

    let corrected = if pa_cf1 < 570.0 {
        low
    } else if pa_cf1 < 611.0 {
        // Linear blend across the transition band so the curve is continuous.
        let w = (0.0244 * pa_cf1 - 13.9).clamp(0.0, 1.0);
        w * high + (1.0 - w) * low
    } else {
        high
    };

    corrected.max(0.0)
}

/// EPA PM2.5 AQI breakpoints, as revised 6 May 2024 (Good now ends at 9.0
/// µg/m³, not 12.0). Source: EPA AQS `aqi_breakpoints` code table.
fn pm25_to_aqi(pm25: f64) -> u32 {
    let aqi = if pm25 <= 9.0 {
        linear(0.0, 50.0, 0.0, 9.0, pm25)
    } else if pm25 <= 35.4 {
        linear(51.0, 100.0, 9.1, 35.4, pm25)
    } else if pm25 <= 55.4 {
        linear(101.0, 150.0, 35.5, 55.4, pm25)
    } else if pm25 <= 125.4 {
        linear(151.0, 200.0, 55.5, 125.4, pm25)
    } else if pm25 <= 225.4 {
        linear(201.0, 300.0, 125.5, 225.4, pm25)
    } else if pm25 <= 325.4 {
        linear(301.0, 500.0, 225.5, 325.4, pm25)
    } else {
        500.0
    };
    aqi.round() as u32
}

fn linear(aqi_lo: f64, aqi_hi: f64, conc_lo: f64, conc_hi: f64, conc: f64) -> f64 {
    (aqi_hi - aqi_lo) / (conc_hi - conc_lo) * (conc - conc_lo) + aqi_lo
}

fn median(mut values: Vec<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = values.len();
    if n % 2 == 1 {
        values[n / 2]
    } else {
        (values[n / 2 - 1] + values[n / 2]) / 2.0
    }
}

/// Equirectangular approximation in kilometres — accurate to well under 1% over
/// the ~150 km span of Kern County, and far cheaper than full haversine.
fn distance_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let dlat = (lat2 - lat1) * 111.32;
    let dlng = (lng2 - lng1) * 111.32 * lat1.to_radians().cos();
    (dlat * dlat + dlng * dlng).sqrt()
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
            PurpleAirError::Http(e) => write!(f, "HTTP error: {e}"),
            PurpleAirError::Api(status, body) => write!(f, "PurpleAir API {status}: {body}"),
            PurpleAirError::NoSensors => write!(f, "no sensors returned"),
        }
    }
}

impl std::error::Error for PurpleAirError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aqi_uses_2024_breakpoints() {
        // 9.0 µg/m³ is the top of "Good" as of 6 May 2024 (was 12.0).
        assert_eq!(pm25_to_aqi(0.0), 0);
        assert_eq!(pm25_to_aqi(9.0), 50);
        assert_eq!(pm25_to_aqi(9.1), 51);
        assert_eq!(pm25_to_aqi(35.4), 100);
        assert_eq!(pm25_to_aqi(55.4), 150);
        assert_eq!(pm25_to_aqi(125.4), 200);
        assert_eq!(pm25_to_aqi(225.4), 300);
        // Under the retired table 10.0 scored 42 ("Good"); it is now Moderate.
        assert_eq!(pm25_to_aqi(10.0), 53);
    }

    #[test]
    fn epa_correction_reduces_raw_purpleair() {
        // Raw PurpleAir over-reads, so the corrected value must be lower.
        let raw = 20.0;
        let corrected = epa_correct(raw, 30.0);
        assert!(corrected < raw, "expected correction to lower {raw}, got {corrected}");
        // 0.524*20 - 0.0862*30 + 5.75 = 13.644
        assert!((corrected - 13.644).abs() < 1e-6, "got {corrected}");
    }

    #[test]
    fn epa_correction_is_continuous_across_the_smoke_transition() {
        let rh = 40.0;
        let below = epa_correct(569.9, rh);
        let inside = epa_correct(590.0, rh);
        let above = epa_correct(611.1, rh);
        assert!(below < inside && inside < above, "{below} {inside} {above}");
        // No discontinuity at either edge of the blend band.
        assert!((epa_correct(570.0, rh) - below).abs() < 1.0);
        assert!((epa_correct(611.0, rh) - above).abs() < 1.0);
    }

    #[test]
    fn correction_never_returns_negative() {
        // Clean air plus high humidity drives the linear form below zero.
        assert_eq!(epa_correct(0.0, 100.0), 0.0);
    }

    #[test]
    fn median_ignores_a_single_broken_sensor() {
        // A sensor stuck at 3328 µg/m³ (seen in Taft) must not move the value.
        let v = vec![9.0, 10.0, 11.0, 12.0, 3328.0];
        assert_eq!(median(v), 11.0);
    }

    #[test]
    fn distance_km_is_accurate_for_kern() {
        // Bakersfield -> Delano is 48.7 km great-circle.
        let d = distance_km(35.3733, -119.0187, 35.7688, -119.2471);
        assert!((d - 48.7).abs() < 1.0, "got {d} km");
        // Bakersfield -> Ridgecrest is ~136 km, comfortably outside the radius.
        let far = distance_km(35.3733, -119.0187, 35.6225, -117.6709);
        assert!(far > MAX_STATION_RADIUS_KM * 5.0, "got {far} km");
    }

    #[test]
    fn sixty_minute_average_preferred_outside_the_smoke_regime() {
        let clean = RawSensor {
            name: "t".into(), lat: 0.0, lng: 0.0, confidence: 100,
            humidity: 20.0, pm25_cf1: 8.0, pm25_60m: Some(6.0),
        };
        assert_eq!(clean.correction_input(), 6.0);

        // In smoke the ATM 60-minute average saturates, so CF=1 wins.
        let smoky = RawSensor { pm25_cf1: 300.0, ..clean };
        assert_eq!(smoky.correction_input(), 300.0);
    }
}
