[Root Directory](../CLAUDE.md) > **Cloud Functions Module**

---

# Cloud Functions Module

**Path**: `functions/src/index.ts`

**Responsibility**: Firebase Cloud Functions (Node.js 22, TypeScript) providing server-side logic: email delivery, best times synchronization, tournament history aggregation, avatar caching, and team verification.

---

## Entry Point

`functions/src/index.ts` -- Single file containing all exported Cloud Functions.

---

## Functions Inventory

| Function | Type | Trigger | Description |
|----------|------|---------|-------------|
| `sendEmail` | `onRequest` | HTTP POST `/sendEmail` | Sends team verification email (Resend primary, AWS SES fallback) |
| `updateVerification` | `onRequest` | HTTP POST `/updateVerification` | Processes team member verification, updates team/registration/user documents |
| `cacheGoogleAvatarCallable` | `onCall` | Callable | Downloads and caches Google profile avatar to Firebase Storage |
| `updateUserBestTimes` | `onDocumentWritten` | `records/{recordId}` | Updates user's `best_times` when a non-prelim record is saved |
| `syncUserTournamentHistoryFromRecords` | `onDocumentWritten` | `records/{recordId}` | Aggregates all records into `user_tournament_history` |
| `syncUserTournamentHistoryFromPrelimRecords` | `onDocumentWritten` | `prelim_records/{recordId}` | Same as above for prelim records |
| `syncUserTournamentHistoryFromOverallRecords` | `onDocumentWritten` | `overall_records/{recordId}` | Same for overall records |
| `updateUserBestTimesFromOverall` | `onDocumentWritten` | `overall_records/{recordId}` | Updates individual best times from overall record |

---

## Email Flow

```
Client -> POST /sendEmail (Bearer token)
  -> Verify Firebase ID token
  -> Create verification_request document in Firestore
  -> Try Resend API (primary)
  -> If fails: Try AWS SES SMTP (backup)
  -> If both fail: Return 500 with error details
```

### sendEmail Request Body
```typescript
{
  to: string;              // Recipient email
  tournamentId: string;
  teamId: string;
  memberId: string;        // The global_id of the invitee
  registrationId: string;
}
```

### updateVerification Request Body
```typescript
{
  tournamentId: string;
  teamId: string;
  memberId: string;        // Must match the authenticated user's global_id
  registrationId: string;
}
```

**Authorization**: The authenticated user (via Firebase ID token) must have `global_id === memberId`. The requester can only verify their own membership.

---

## Verification Logic (`updateVerification`)

1. Verify caller owns the `memberId` (via Firestore user document lookup)
2. Find or create registration for this member in this tournament
3. Run Firestore transaction:
   - Load team document
   - Check member exists in team
   - Check member not already verified
   - Check for team event conflicts (no overlapping events with other verified teams)
   - Check for individual event conflicts (no overlapping events already registered)
   - Mark member as verified in team
   - Add events to user's `registration_records`
   - Update registration document with new events
4. Delete recruitment entries (individual, double, team) for the verified member
5. Update `verification_requests` document status to "verified"

---

## Secrets (Firebase Secrets Manager)

```
RESEND_API_KEY            # Primary email provider
AWS_SES_SMTP_USERNAME     # Backup email (SMTP auth)
AWS_SES_SMTP_PASSWORD     # Backup email (SMTP auth)
```

---

## Region

All functions deploy to `asia-southeast1` (configurable via `FUNCTIONS_REGION` env var).

---

## FAQ

**Q: Why does the email function have two providers?**
A: Resend is the primary provider for simplicity. AWS SES is configured as a fallback when Resend fails (outage, rate limit, or error response). Both are tried in sequence within the same request.

**Q: How does the best time update determine if a time is "better"?**
A: It compares `newBestTime < currentBestTime`. If the user has no current best time for that event, the new time is always accepted. Prelim records (`classification: "prelim"`) are ignored -- only final records trigger best time updates.

**Q: What does `user_tournament_history` contain?**
A: A cached, denormalized view of all tournament history for a user -- aggregated from `records`, `prelim_records`, and `overall_records` collections. It includes tournament metadata (name, dates, venue) and all results grouped by tournament.

**Q: How is season labeling computed?**
A: Based on UTC month: if month >= 6 (July onwards), season starts in the current year; otherwise, it starts in the previous year. Format: `YYYY-YYYY` (e.g., "2025-2026").

---

## Related Files

- Frontend caller: `src/services/firebase/verificationRequestService.ts`
- Best times frontend: `src/services/firebase/userBestTimesService.ts`
- User schema: `src/schema/UserSchema.ts` (contains `best_times` shape)
- Deployment: `functions/package.json`, `firebase.json`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Full function inventory, email flow, verification transaction logic, and secrets documented. |
