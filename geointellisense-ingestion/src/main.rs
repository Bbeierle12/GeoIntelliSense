mod aqi;
mod broadcast;
mod config;
mod db;
mod purpleair;
mod redis_cache;
mod routes;
mod usgs;

use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use broadcast::AppState;
use config::Config;
use purpleair::PurpleAirClient;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    dotenvy::dotenv().ok();
    let cfg = Config::from_env();

    let pool = db::connect(&cfg.database_url).await;
    tracing::info!("Connected to database");

    let redis_conn = redis_cache::connect(&cfg.redis_url).await;
    let redis = Arc::new(Mutex::new(redis_conn));

    let pa_client = cfg.purpleair_api_key.map(|key| {
        tracing::info!(
            interval_secs = cfg.purpleair_interval_secs,
            "PurpleAir API key configured — live sensor data enabled"
        );
        PurpleAirClient::new(key)
    });
    if pa_client.is_none() {
        tracing::info!("No PURPLEAIR_API_KEY — using mock AQI data");
    }

    let tx = broadcast::create();
    let cache = Arc::new(RwLock::new(None));
    let quake_cache = Arc::new(RwLock::new(Vec::new()));

    broadcast::spawn_ticker(
        tx.clone(),
        pool.clone(),
        cache.clone(),
        redis.clone(),
        pa_client,
        cfg.broadcast_interval_secs,
        cfg.purpleair_interval_secs,
    );
    tracing::info!(
        broadcast_secs = cfg.broadcast_interval_secs,
        "AQI broadcast started, persisting to sensor_readings"
    );

    broadcast::spawn_earthquake_poller(
        pool.clone(),
        quake_cache.clone(),
        redis.clone(),
        cfg.earthquake_interval_secs,
    );
    tracing::info!(
        interval_secs = cfg.earthquake_interval_secs,
        "USGS earthquake poller started"
    );

    let state = AppState {
        tx,
        pool,
        cache,
        quake_cache,
        redis,
        admin_token: cfg.admin_token,
    };

    let app = routes::router(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{}", cfg.port);
    tracing::info!("Listening on {addr}");
    let listener = TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
