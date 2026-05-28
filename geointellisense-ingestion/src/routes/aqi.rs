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
            None => {
                let stations = aqi::stations();
                aqi::generate_readings(&stations)
            }
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
