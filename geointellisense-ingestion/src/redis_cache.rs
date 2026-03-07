use redis::AsyncCommands;

const PREFIX: &str = "geointelli:ingestion";

pub type RedisPool = redis::aio::MultiplexedConnection;

pub async fn connect(url: &str) -> Option<RedisPool> {
    match redis::Client::open(url) {
        Ok(client) => match client.get_multiplexed_async_connection().await {
            Ok(conn) => {
                tracing::info!("Connected to Redis");
                Some(conn)
            }
            Err(e) => {
                tracing::warn!("Redis connection failed (non-fatal): {e}");
                None
            }
        },
        Err(e) => {
            tracing::warn!("Redis URL invalid (non-fatal): {e}");
            None
        }
    }
}

pub async fn set_heartbeat(conn: &mut RedisPool) {
    let key = format!("{PREFIX}:heartbeat");
    let _: Result<(), _> = conn.set_ex(&key, chrono::Utc::now().to_rfc3339(), 30).await;
}

pub async fn cache_snapshot(conn: &mut RedisPool, json: &str) {
    let key = format!("{PREFIX}:snapshot");
    let r: Result<(), _> = conn.set_ex(&key, json, 120).await;
    if let Err(e) = r {
        tracing::warn!("Redis SET snapshot failed: {e}");
    }
}

pub async fn get_snapshot(conn: &mut RedisPool) -> Option<String> {
    let key = format!("{PREFIX}:snapshot");
    match conn.get::<_, Option<String>>(&key).await {
        Ok(Some(v)) => {
            tracing::debug!("Redis cache HIT snapshot");
            Some(v)
        }
        Ok(None) => {
            tracing::debug!("Redis cache MISS snapshot");
            None
        }
        Err(e) => {
            tracing::warn!("Redis GET snapshot failed: {e}");
            None
        }
    }
}

pub async fn flush_all(conn: &mut RedisPool) -> usize {
    let pattern = format!("{PREFIX}:*");
    let keys: Vec<String> = match redis::cmd("KEYS").arg(&pattern).query_async(conn).await {
        Ok(k) => k,
        Err(_) => return 0,
    };
    let count = keys.len();
    if !keys.is_empty() {
        let _: Result<(), _> = conn.del::<_, ()>(keys).await;
    }
    tracing::info!("Redis FLUSH {count} ingestion keys");
    count
}
