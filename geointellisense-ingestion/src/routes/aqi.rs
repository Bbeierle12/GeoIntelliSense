use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::aqi;
use crate::broadcast::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResponse {
    pub readings: Vec<aqi::AqiReading>,
    pub station_count: usize,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub async fn snapshot(State(state): State<AppState>) -> Json<SnapshotResponse> {
    let now = chrono::Utc::now();

    let readings = {
        let cached = state.cache.read().await;
        match cached.as_ref() {
            Some(live) => live
                .iter()
                .map(|r| aqi::AqiReading { timestamp: now, ..r.clone() })
                .collect(),
            // Before the first successful PurpleAir poll there is nothing to
            // report. This branch used to return generate_readings(), which
            // made a cold start indistinguishable from live data.
            None => Vec::new(),
        }
    };

    let count = readings.len();
    Json(SnapshotResponse {
        readings,
        station_count: count,
        timestamp: now,
    })
}

#[derive(Deserialize)]
pub struct HistoryParams {
    #[serde(default = "default_station")]
    pub station_id: String,
    #[serde(default = "default_hours")]
    pub hours: u32,
}

/// Bakersfield — the county's primary reporting community.
fn default_station() -> String {
    "a1b2c3d4-0001-4000-8000-000000000002".into()
}
fn default_hours() -> u32 {
    24
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub station_id: String,
    pub history: Vec<aqi::AqiHistoryPoint>,
    pub count: usize,
}

/// Hourly PM2.5/AQI history for one station, read from stored readings.
///
/// Returns an empty series when nothing has been recorded yet rather than
/// generating a plausible-looking one.
pub async fn history(
    State(state): State<AppState>,
    Query(params): Query<HistoryParams>,
) -> Json<HistoryResponse> {
    let hours = params.hours.clamp(1, 168); // cap at 7 days

    let history = match uuid::Uuid::parse_str(&params.station_id) {
        Ok(id) => fetch_history(&state.pool, id, hours).await,
        Err(_) => {
            tracing::warn!(station_id = %params.station_id, "history: station_id is not a UUID");
            Vec::new()
        }
    };

    let count = history.len();
    Json(HistoryResponse {
        station_id: params.station_id,
        history,
        count,
    })
}

async fn fetch_history(
    pool: &sqlx::PgPool,
    station_id: uuid::Uuid,
    hours: u32,
) -> Vec<aqi::AqiHistoryPoint> {
    let rows = sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>, Option<f64>, Option<f64>)>(
        "SELECT time_bucket('1 hour', time) AS bucket, \
                avg(pm25) AS pm25, \
                avg(aqi::double precision) AS aqi \
           FROM sensor_readings \
          WHERE location_id = $1 \
            AND time >= now() - make_interval(hours => $2) \
            AND source <> 'mock' \
          GROUP BY bucket \
          ORDER BY bucket",
    )
    .bind(station_id)
    .bind(hours as i32)
    .fetch_all(pool)
    .await;

    match rows {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|(bucket, pm25, aqi)| {
                Some(aqi::AqiHistoryPoint {
                    timestamp: bucket,
                    aqi: aqi?.round() as u32,
                    pm25: aqi::round2(pm25?),
                    pm10: None,
                    o3: None,
                    source: "purpleair",
                })
            })
            .collect(),
        Err(e) => {
            tracing::error!("history query failed: {e}");
            Vec::new()
        }
    }
}
