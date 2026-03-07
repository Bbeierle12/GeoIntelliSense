pub mod admin;
pub mod aqi;
pub mod earthquakes;
pub mod health;
pub mod sse;

use axum::{routing::{get, post}, Router};

use crate::broadcast::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::check))
        .route("/api/aqi-stream", get(sse::handler))
        .route("/api/aqi-snapshot", get(aqi::snapshot))
        .route("/api/aqi-history", get(aqi::history))
        .route("/api/earthquakes/cached", get(earthquakes::recent))
        .route("/api/admin/cache/flush", post(admin::cache_flush))
        .with_state(state)
}
