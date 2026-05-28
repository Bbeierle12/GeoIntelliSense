use std::env;

pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub purpleair_api_key: Option<String>,
    pub purpleair_interval_secs: u64,
    pub broadcast_interval_secs: u64,
    pub earthquake_interval_secs: u64,
    pub redis_url: String,
    pub admin_token: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://geointellisense:geointellisense_dev@localhost:5432/geointellisense".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3001),
            purpleair_api_key: env::var("PURPLEAIR_API_KEY").ok().filter(|k| !k.is_empty()),
            purpleair_interval_secs: env::var("PURPLEAIR_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(600),  // 10 min default — PurpleAir free tier is 1000 pts/day
            broadcast_interval_secs: env::var("BROADCAST_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            earthquake_interval_secs: env::var("EARTHQUAKE_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(300),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".into()),
            admin_token: env::var("ADMIN_TOKEN").ok().filter(|t| !t.is_empty()),
        }
    }
}
