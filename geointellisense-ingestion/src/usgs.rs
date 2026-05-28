use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

// Global bounding box defaults — ingest worldwide earthquake data
const DEFAULT_MIN_LAT: f64 = -90.0;
const DEFAULT_MAX_LAT: f64 = 90.0;
const DEFAULT_MIN_LNG: f64 = -180.0;
const DEFAULT_MAX_LNG: f64 = 180.0;

const USGS_URL: &str = "https://earthquake.usgs.gov/fdsnws/event/1/query";

/// Configurable bounding box for earthquake queries.
#[derive(Debug, Clone)]
pub struct BBox {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl Default for BBox {
    fn default() -> Self {
        Self {
            min_lat: DEFAULT_MIN_LAT,
            max_lat: DEFAULT_MAX_LAT,
            min_lng: DEFAULT_MIN_LNG,
            max_lng: DEFAULT_MAX_LNG,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarthquakeEvent {
    pub event_id: String,
    pub time: DateTime<Utc>,
    pub magnitude: f64,
    pub depth_km: f64,
    pub lat: f64,
    pub lng: f64,
    pub place: String,
    pub felt: Option<i32>,
    pub tsunami: bool,
    pub alert: Option<String>,
    pub status: String,
}

// ── USGS GeoJSON response types ──

#[derive(Deserialize)]
struct UsgsResponse {
    features: Vec<UsgsFeature>,
}

#[derive(Deserialize)]
struct UsgsFeature {
    id: String,
    properties: UsgsProperties,
    geometry: UsgsGeometry,
}

#[derive(Deserialize)]
struct UsgsProperties {
    mag: Option<f64>,
    place: Option<String>,
    time: Option<i64>,
    felt: Option<i32>,
    tsunami: Option<i32>,
    alert: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct UsgsGeometry {
    coordinates: Vec<f64>, // [lng, lat, depth]
}

/// Fetch and persist earthquakes using the default SJV bounding box.
pub async fn fetch_and_persist(pool: &PgPool) -> Vec<EarthquakeEvent> {
    fetch_and_persist_bbox(pool, &BBox::default()).await
}

/// Fetch and persist earthquakes using a custom bounding box.
pub async fn fetch_and_persist_bbox(pool: &PgPool, bbox: &BBox) -> Vec<EarthquakeEvent> {
    match fetch_recent(bbox).await {
        Ok(events) => {
            if events.is_empty() {
                tracing::debug!("USGS: no earthquakes in bbox region");
                return events;
            }
            tracing::info!("USGS: {} earthquakes fetched", events.len());
            persist(pool, &events).await;
            events
        }
        Err(e) => {
            tracing::warn!("USGS fetch failed: {e}");
            Vec::new()
        }
    }
}

async fn fetch_recent(bbox: &BBox) -> Result<Vec<EarthquakeEvent>, Box<dyn std::error::Error + Send + Sync>> {
    let now = Utc::now();
    let start = now - chrono::Duration::days(30);

    let client = reqwest::Client::new();
    let resp = client
        .get(USGS_URL)
        .query(&[
            ("format", "geojson"),
            ("starttime", &start.format("%Y-%m-%d").to_string()),
            ("endtime", &now.format("%Y-%m-%d").to_string()),
            ("minlatitude", &bbox.min_lat.to_string()),
            ("maxlatitude", &bbox.max_lat.to_string()),
            ("minlongitude", &bbox.min_lng.to_string()),
            ("maxlongitude", &bbox.max_lng.to_string()),
            ("minmagnitude", "0.5"),
            ("orderby", "time"),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("USGS API {status}: {body}").into());
    }

    let data: UsgsResponse = resp.json().await?;

    let events: Vec<EarthquakeEvent> = data
        .features
        .into_iter()
        .filter_map(|f| {
            let mag = f.properties.mag?;
            let time_ms = f.properties.time?;
            let time = DateTime::from_timestamp_millis(time_ms)?;
            let coords = &f.geometry.coordinates;
            if coords.len() < 3 {
                return None;
            }

            Some(EarthquakeEvent {
                event_id: f.id,
                time,
                magnitude: mag,
                depth_km: coords[2],
                lng: coords[0],
                lat: coords[1],
                place: f.properties.place.unwrap_or_default(),
                felt: f.properties.felt,
                tsunami: f.properties.tsunami.map(|t| t > 0).unwrap_or(false),
                alert: f.properties.alert,
                status: f.properties.status.unwrap_or_else(|| "automatic".into()),
            })
        })
        .collect();

    Ok(events)
}

async fn persist(pool: &PgPool, events: &[EarthquakeEvent]) {
    let mut inserted = 0u32;
    for e in events {
        let result = sqlx::query(
            "INSERT INTO earthquake_events \
             (time, event_id, magnitude, depth_km, geom, place, felt, tsunami, alert, status, source) \
             VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $10, $11, 'usgs') \
             ON CONFLICT (event_id, time) DO NOTHING"
        )
        .bind(e.time)
        .bind(&e.event_id)
        .bind(e.magnitude)
        .bind(e.depth_km)
        .bind(e.lng)
        .bind(e.lat)
        .bind(&e.place)
        .bind(e.felt)
        .bind(e.tsunami)
        .bind(&e.alert)
        .bind(&e.status)
        .execute(pool)
        .await;

        match result {
            Ok(r) => { if r.rows_affected() > 0 { inserted += 1; } }
            Err(err) => tracing::error!(event_id = %e.event_id, "Failed to persist earthquake: {err}"),
        }
    }
    if inserted > 0 {
        tracing::info!("USGS: {inserted} new earthquakes persisted");
    }
}
