# Firebase Upload Incident Runbook

## Scope
- Incident type: tournament registration payment-proof upload keeps loading or fails.
- Affected flow: `RegisterTournament` payment proof upload to Firebase Storage.

## 1) Time Alignment
- Capture exact incident window in local timezone.
- Format example: `2026-02-25 09:00 to 16:00 (UTC+08:00)`.
- Capture affected tournament ID and user Global ID samples.

## 2) Firebase Status Check
- Open Firebase Status Dashboard.
- Verify whether Firebase Storage, Authentication, or App Check had incidents in the exact window.
- If status incident overlaps with the same window, flag as possible provider-side event.

## 3) Cloud Logging Queries
- Filter by project and incident window.
- Check for:
  - Storage permission failures (`storage/unauthorized`, HTTP 403)
  - Quota/limit failures (429, quota exceeded)
  - Server errors (5xx)
  - App Check token validation failures
- Correlate error spike time with user reports.

## 4) Monitoring Metrics
- Review Firebase/GCP dashboards for:
  - Storage request error rate
  - Storage request latency
  - Auth/App Check rejection rate
- If error rate is normal but frontend reports hanging uploads, prioritize client-side state or Promise lifecycle bugs.

## 5) Frontend Cross-Validation
- In browser DevTools:
  - Check network request lifecycle for upload and token calls.
  - Confirm upload request either succeeds or fails; no indefinitely pending request should remain after timeout.
- In console logs, search for structured upload errors from:
  - `Payment proof upload failed`
  - `Upload timed out`
  - `Failed to fetch uploaded file URL`

## 6) Triage Decision
- Provider-side likely:
  - Firebase status incident exists and metrics/logs show broad error spike.
- App-side likely:
  - No provider incident and errors are isolated to this flow.
  - Structured client logs show timeout/state handling or permission mismatch.

## 7) Preventive Controls
- Enforce upload timeout (`120000ms`) and reject on timeout.
- Ensure upload failures always release loading state.
- Keep structured logging with:
  - `firebaseCode`, `fileSize`, `tournamentId`, `userGlobalId`, `timestamp`
- Configure alerts for:
  - Elevated Storage 4xx/5xx
  - Quota and App Check rejection spikes

## 8) Manual Regression Checklist
- Upload valid JPG/PNG/GIF < 10MB.
- Upload invalid type and >10MB files.
- Simulate offline network during upload.
- Simulate Storage permission denial.
- Verify Register button does not remain loading after failure.
