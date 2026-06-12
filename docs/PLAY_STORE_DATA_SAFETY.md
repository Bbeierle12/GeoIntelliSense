# Google Play Data safety mapping (working draft)

Use this as the source-of-truth worksheet when completing the Play Console Data safety form.

## Data types collected/shared

| Data type | Collected | Shared | Purpose |
|---|---:|---:|---|
| Precise location | Yes (with runtime consent) | Yes (backend/AI processing for location-based requests) | App functionality |
| App interactions (prompts, feature usage) | Yes | Yes (backend/AI processing) | App functionality, analytics |
| Diagnostics (errors, service health) | Yes | Potentially | App functionality, fraud/security, debugging |
| Device identifiers | **Review implementation** | **Review implementation** | If used by analytics/crash tooling |

## Policy notes
- Location access is behind prominent in-app disclosure + runtime permission request.
- Production network calls are HTTPS-only.
- No hardcoded admin token is shipped in production client UI.

## Before final submission
- Verify final SDK integrations and telemetry providers.
- Confirm retention periods and deletion process.
- Update this file and Play answers if data flows change.
