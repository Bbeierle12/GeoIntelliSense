use std::sync::Arc;
use sqlx::PgPool;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{self, Duration};

use crate::aqi::{self, AqiReading};
use crate::db::persist;
use crate::purpleair::PurpleAirClient;
use crate::redis_cache;
use crate::usgs;

pub type AqiBroadcast = broadcast::Sender<Arc<Vec<AqiReading>>>;

/// Shared cache of the latest readings (from PurpleAir or mock).
pub type LiveCache = Arc<RwLock<Option<Vec<AqiReading>>>>;

/// Shared cache of recent significant earthquakes for SSE push.
pub type EarthquakeCache = Arc<RwLock<Vec<usgs::EarthquakeEvent>>>;

/// Optional Redis connection shared across handlers.
pub type RedisConn = Arc<tokio::sync::Mutex<Option<redis_cache::RedisPool>>>;

#[derive(Clone)]
pub struct AppState {
    pub tx: AqiBroadcast,
    pub pool: PgPool,
    pub cache: LiveCache,
    pub quake_cache: EarthquakeCache,
    pub redis: RedisConn,
    pub admin_token: Option<String>,
}

pub fn create() -> AqiBroadcast {
    let (tx, _) = broadcast::channel::<Arc<Vec<AqiReading>>>(64);
    tx
}

pub fn spawn_ticker(
    tx: AqiBroadcast,
    pool: PgPool,
    cache: LiveCache,
    redis: RedisConn,
    pa_client: Option<PurpleAirClient>,
    broadcast_secs: u64,
    purpleair_secs: u64,
) {
    let stations = aqi::stations();

    if let Some(client) = pa_client {
        let cache_w = cache.clone();
        let stations_pa = stations.clone();
        let pa = Arc::new(client);
        let redis_pa = redis.clone();

        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(purpleair_secs));
            loop {
                interval.tick().await;

                // Check toggle in Redis — skip fetch if purpleair is disabled
                {
                    let mut guard = redis_pa.lock().await;
                    if let Some(ref mut conn) = *guard {
                        if !redis_cache::is_source_enabled(conn, "purpleair").await {
                            tracing::debug!("PurpleAir source disabled, skipping fetch");
                            continue;
                        }
                    }
                    // If Redis is down, skip fetch (fail-safe: don't burn API points)
                    else {
                        tracing::debug!("Redis unavailable, skipping PurpleAir fetch");
                        continue;
                    }
                }

                match pa.fetch_readings(&stations_pa).await {
                    Ok(mut readings) if !readings.is_empty() => {
                        let covered: std::collections::HashSet<_> =
                            readings.iter().map(|r| r.station_id).collect();
                        let mock = aqi::generate_readings(&stations_pa);
                        for m in mock {
                            if !covered.contains(&m.station_id) {
                                tracing::debug!(station = %m.station_name, "No PurpleAir sensors nearby, using mock");
                                readings.push(m);
                            }
                        }
                        tracing::info!("PurpleAir fetch OK — {} readings cached", readings.len());
                        *cache_w.write().await = Some(readings);
                    }
                    Ok(_) => tracing::warn!("PurpleAir returned no readings, cache unchanged"),
                    Err(e) => tracing::warn!("PurpleAir fetch failed: {e}, cache unchanged"),
                }
            }
        });
    }

    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(broadcast_secs));
        loop {
            interval.tick().await;

            let readings = {
                let cached = cache.read().await;
                match cached.as_ref() {
                    Some(live) => {
                        let now = chrono::Utc::now();
                        live.iter()
                            .map(|r| AqiReading { timestamp: now, ..r.clone() })
                            .collect()
                    }
                    None => aqi::generate_readings(&stations),
                }
            };

            persist::write_readings(&pool, &readings).await;

            // Cache snapshot in Redis + heartbeat
            {
                let mut guard = redis.lock().await;
                if let Some(ref mut conn) = *guard {
                    if let Ok(json) = serde_json::to_string(&readings) {
                        redis_cache::cache_snapshot(conn, &json).await;
                    }
                    redis_cache::set_heartbeat(conn).await;
                }
            }

            let _ = tx.send(Arc::new(readings));
        }
    });
}

/// Spawns the USGS earthquake poller. Fetches every `interval_secs`, persists to DB,
/// and caches M3.0+ events for SSE push.
pub fn spawn_earthquake_poller(pool: PgPool, quake_cache: EarthquakeCache, redis: RedisConn, interval_secs: u64) {
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(interval_secs));
        loop {
            interval.tick().await;

            // Check toggle in Redis
            {
                let mut guard = redis.lock().await;
                if let Some(ref mut conn) = *guard {
                    if !redis_cache::is_source_enabled(conn, "usgs_earthquakes").await {
                        tracing::debug!("USGS earthquakes source disabled, skipping fetch");
                        continue;
                    }
                } else {
                    continue;
                }
            }

            let events = usgs::fetch_and_persist(&pool).await;

            // Cache only significant events (M3.0+) for SSE consumers
            let significant: Vec<_> = events
                .into_iter()
                .filter(|e| e.magnitude >= 3.0)
                .collect();

            if !significant.is_empty() {
                tracing::info!("USGS: {} significant events (M3.0+) cached for SSE", significant.len());
            }
            *quake_cache.write().await = significant;
        }
    });
}
