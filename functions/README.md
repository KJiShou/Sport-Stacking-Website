# Firebase Cloud Functions

This directory contains the Firebase Cloud Functions for the Sport Stacking Website.

## Available Functions

### `sendEmail`
Sends verification emails to tournament participants with automatic backup failover.

**Primary Service**: Resend API
**Backup Service**: AWS SES (automatically triggered if Resend fails)

## Required Secrets

These secrets must be configured using Firebase Secrets Manager:

```bash
# Resend API key (primary email service)
firebase functions:secrets:set RESEND_API_KEY

# AWS SES credentials (backup email service)
firebase functions:secrets:set AWS_SES_SMTP_USERNAME
firebase functions:secrets:set AWS_SES_SMTP_PASSWORD
```

## Environment Variables

Optional configuration via environment variables:

```bash
# Resend configuration
RESEND_FROM_EMAIL="RankingStack <noreply@rankingstack.com>"
RESEND_API_URL="https://api.resend.com/emails"

# AWS SES configuration
AWS_SES_REGION="us-east-1"
AWS_SES_FROM_EMAIL="RankingStack <noreply@rankingstack.com>"
```

## Development

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Watch for changes and rebuild
yarn build:watch

# Run functions emulator
yarn serve

# Deploy to Firebase
yarn deploy
```

## Email Service Failover

The `sendEmail` function implements automatic failover:

1. **Attempt 1**: Send via Resend API
2. **Attempt 2**: If Resend fails, automatically retry via AWS SES
3. **Response**: Includes `provider` field indicating which service was used

Example response:
```json
{
  "success": true,
  "id": "message-id-123",
  "provider": "resend"  // or "aws-ses" if backup was used
}
```

## Setup Guide

For detailed AWS SES setup instructions, see [AWS_SES_SETUP.md](../AWS_SES_SETUP.md) in the project root.

## Testing

To test email sending locally:

1. Start the Firebase emulator:
   ```bash
   yarn serve
   ```

2. Make a POST request to the local endpoint with a valid Firebase auth token.

## Troubleshooting

- **Secrets not found**: Run `firebase functions:secrets:access <SECRET_NAME>` to verify
- **Email not sending**: Check Firebase function logs with `yarn logs`
- **AWS SES errors**: Verify sender email is verified in AWS SES console
- **Build errors**: Run `yarn build` to see TypeScript compilation errors

## Repair imported registration phone numbers

Excel imports preserve a nonblank registration phone number, or copy the matched
profile's phone when the registration contact is blank. Profile changes do not
subsequently overwrite an existing registration contact.

The repair CLI is restricted to the ISSF Asian Open 2026 tournament in the
production `(default)` database. It only fills blank contacts on approved
`admin_import` registrations. Run from the repository root with production Admin
SDK credentials:

```bash
yarn workspace functions build
yarn workspace functions repair:registration-phones --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N
yarn workspace functions repair:registration-phones --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N --apply
```

Omitting `--apply` previews without writing. Identity conflicts, ambiguous profile
matches and profiles without a phone are reported by record ID. Repeating the
repair does not overwrite existing contacts. Each update atomically saves full
before/after snapshots under the server-only
`repair_manifests/registration-phones-qzhR8w2Zs7MNUtlycL9N/entries` collection and
writes an audit entry. Snapshots contain contact data; do not export them into
source control or terminal logs. Use `--repair-id <id>` for a separate repair run.

To preview or apply restoration of this repair:

```bash
yarn workspace functions repair:registration-phones --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N --restore
yarn workspace functions repair:registration-phones --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N --restore --apply
```

Restoration requires the entire registration to still match the saved post-repair
snapshot; subsequent edits are skipped. It restores only the original phone and
update timestamp, including missing fields. Original import journals are left
intact: import undo may detect this repair as a later edit. Restore the phone
repair before attempting to undo the original import.
