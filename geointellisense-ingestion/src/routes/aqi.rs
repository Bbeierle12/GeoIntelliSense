use axum::extract::Query;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::aqi;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResponse {
    pub readings: Vec<aqi::AqiReading>,
    pub station_count: usize,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub async fn snapshot() -> Json<SnapshotResponse> {
    let stations = aqi::stations();
    let readings = aqi::generate_readings(&stations);
    let count = readings.len();
    Json(SnapshotResponse {
        readings,
        station_count: count,
        timestamp: chrono::Utc::now(),
    })
}

#[derive(Deserialize)]
pub struct HistoryParams {
    #[serde(default = "default_station")]
    pub station_id: String,
    #[serde(default = "default_hours")]
    pub hours: u32,
}

fn default_station() -> String {
    "AQ-001".into()
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

pub async fn history(Query(params): Query<HistoryParams>) -> Json<HistoryResponse> {
    let hours = params.hours.min(168); // cap at 7 days
    let history = aqi::generate_history(&params.station_id, hours);
    let count = history.len();
    Json(HistoryResponse {
        station_id: params.station_id,
        history,
        count,
    })
}
