use sqlx::PgPool;

use crate::aqi::AqiReading;

pub async fn write_readings(pool: &PgPool, readings: &[AqiReading]) {
    for r in readings {
        let result = sqlx::query(
            "INSERT INTO sensor_readings \
             (time, location_id, pm25, pm10, o3, no2, so2, co, aqi, temperature, humidity, wind_speed, wind_direction) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)"
        )
        .bind(r.timestamp)
        .bind(r.station_id)
        .bind(r.pm25)
        .bind(r.pm10)
        .bind(r.o3)
        .bind(r.no2)
        .bind(r.so2)
        .bind(r.co)
        .bind(r.aqi as i32)
        .bind(r.temperature)
        .bind(r.humidity)
        .bind(r.wind_speed)
        .bind(r.wind_direction)
        .execute(pool)
        .await;

        if let Err(e) = result {
            tracing::error!(station = %r.station_name, "Failed to persist reading: {e}");
        }
    }
}
