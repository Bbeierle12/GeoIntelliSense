use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::broadcast::AppState;
use crate::usgs::EarthquakeEvent;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EarthquakeResponse {
    pub events: Vec<EarthquakeEvent>,
    pub count: usize,
}

pub async fn recent(State(state): State<AppState>) -> Json<EarthquakeResponse> {
    let events = state.quake_cache.read().await.clone();
    let count = events.len();
    Json(EarthquakeResponse { events, count })
}
