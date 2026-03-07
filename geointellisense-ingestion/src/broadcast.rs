use std::sync::Arc;
use sqlx::PgPool;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{self, Duration};

use crate::aqi::{self, AqiReading};
use crate::db::persist;
use crate::purpleair::PurpleAirClient;

pub type AqiBroadcast = broadcast::Sender<Arc<Vec<AqiReading>>>;

/// Cached result from the most recent PurpleAir fetch.
type LiveCache = Arc<RwLock<Option<Vec<AqiReading>>>>;

#[derive(Clone)]
pub struct AppState {
    pub tx: AqiBroadcast,
    pub pool: PgPool,
}

pub fn create() -> AqiBroadcast {
    let (tx, _) = broadcast::channel::<Arc<Vec<AqiReading>>>(64);
    tx
}

pub fn spawn_ticker(
    tx: AqiBroadcast,
    pool: PgPool,
    pa_client: Option<PurpleAirClient>,
    broadcast_secs: u64,
    purpleair_secs: u64,
) {
    let stations = aqi::stations();
    let cache: LiveCache = Arc::new(RwLock::new(None));

    // If we have a PurpleAir client, spawn a separate fetcher on a slower cadence.
    if let Some(client) = pa_client {
        let cache_w = cache.clone();
        let stations_pa = stations.clone();
        let pa = Arc::new(client);

        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(purpleair_secs));
            loop {
                interval.tick().await;

                match pa.fetch_readings(&stations_pa).await {
                    Ok(mut readings) if !readings.is_empty() => {
                        // Fill gaps: if PurpleAir didn't cover a station, use mock
                        let covered: std::collections::HashSet<_> =
                            readings.iter().map(|r| r.station_id).collect();
                        let mock = aqi::generate_readings(&stations_pa);
                        for m in mock {
                            if !covered.contains(&m.station_id) {
                                tracing::debug!(
                                    station = %m.station_name,
                                    "No PurpleAir sensors nearby, using mock"
                                );
                                readings.push(m);
                            }
                        }
                        tracing::info!(
                            "PurpleAir fetch OK — {} readings cached",
                            readings.len()
                        );
                        *cache_w.write().await = Some(readings);
                    }
                    Ok(_) => {
                        tracing::warn!("PurpleAir returned no readings, cache unchanged");
                    }
                    Err(e) => {
                        tracing::warn!("PurpleAir fetch failed: {e}, cache unchanged");
                    }
                }
            }
        });
    }

    // Main broadcast loop — runs every `broadcast_secs` (default 5s).
    // Reads from cache if available, otherwise generates mock data.
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(broadcast_secs));
        loop {
            interval.tick().await;

            let readings = {
                let cached = cache.read().await;
                match cached.as_ref() {
                    Some(live) => {
                        // Re-stamp with current time so SSE consumers see fresh timestamps
                        let now = chrono::Utc::now();
                        live.iter()
                            .map(|r| AqiReading { timestamp: now, ..r.clone() })
                            .collect()
                    }
                    None => aqi::generate_readings(&stations),
                }
            };

            persist::write_readings(&pool, &readings).await;
            let _ = tx.send(Arc::new(readings));
        }
    });
}
