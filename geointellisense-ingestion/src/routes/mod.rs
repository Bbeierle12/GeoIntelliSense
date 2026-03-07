pub mod aqi;
pub mod health;
pub mod sse;

use axum::{routing::get, Router};

use crate::broadcast::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::check))
        .route("/api/aqi-stream", get(sse::handler))
        .route("/api/aqi-snapshot", get(aqi::snapshot))
        .route("/api/aqi-history", get(aqi::history))
        .with_state(state)
}
