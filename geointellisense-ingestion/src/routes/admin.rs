use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;

use crate::broadcast::AppState;
use crate::redis_cache;

#[derive(Serialize)]
pub struct FlushResponse {
    flushed: usize,
}

pub async fn cache_flush(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, StatusCode> {
    let token = match &state.admin_token {
        Some(t) => t,
        None => return Err(StatusCode::FORBIDDEN),
    };

    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if provided != token {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let count = {
        let mut guard = state.redis.lock().await;
        match guard.as_mut() {
            Some(conn) => redis_cache::flush_all(conn).await,
            None => 0,
        }
    };

    Ok(Json(FlushResponse { flushed: count }))
}
