use std::convert::Infallible;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::broadcast::AppState;

static CLIENT_COUNT: AtomicUsize = AtomicUsize::new(0);

pub async fn handler(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.tx.subscribe();
    let client_id = CLIENT_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    let active = Arc::new(());

    tracing::info!(client_id, "SSE client connected");

    let connected_event = futures::stream::once(async move {
        Ok(Event::default()
            .event("connected")
            .data(format!(r#"{{"clientId":{client_id}}}"#)))
    });

    let tracker = active.clone();
    let data_stream = BroadcastStream::new(rx)
        .filter_map(move |msg: Result<_, _>| {
            let _keep = tracker.clone();
            match msg {
                Ok(readings) => Some(Ok(Event::default()
                    .event("aqi-update")
                    .data(serde_json::to_string(readings.as_ref()).unwrap()))),
                Err(_) => None,
            }
        });

    let active_for_drop = active;
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if Arc::strong_count(&active_for_drop) == 1 {
                tracing::info!(client_id, "SSE client disconnected");
                break;
            }
        }
    });

    Sse::new(connected_event.chain(data_stream))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(30))
                .text("heartbeat"),
        )
}
