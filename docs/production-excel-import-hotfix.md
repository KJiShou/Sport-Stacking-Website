# Production Excel import hotfix runbook

Scope: tournament `qzhR8w2Zs7MNUtlycL9N` in the production `(default)` Firestore database only.

## Preconditions

- Review and merge this branch, then deploy Functions, Hosting, and Firestore rules from the same pushed commit SHA through the normal release process. Do not deploy an unpushed local checkout.
- Record the final workbook SHA-256 and deployed commit SHA.
- Verify the import modal at desktop, mobile, and 200% zoom before changing production data.
- Record an Auth and Storage baseline. The cleanup tools never mutate Auth or Storage.

## Maintenance and backup

Disable writes. The write-control tool requires the production acknowledgement even when enabling writes again.

```sh
yarn workspace functions maintenance:write-control --database '(default)' --disabled --allow-primary --primary-confirm change-default-write-control --actor production-import-cleanup
```

Confirm an ordinary client write and a non-import mutating Function are rejected. Then create a fresh managed Firestore export of `(default)` and record its location and completion time.

## Fresh cleanup plan

Choose one fixed canonical UTC timestamp and repair ID. Do not reuse an older report checksum.

```sh
yarn workspace functions cleanup:tournament-import --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N --repair-id REPAIR_ID --as-of 2026-08-20T00:00:00.000Z --allow-primary-read-only
```

The dry-run must report zero `blockingFailures`. Review the candidate profiles, Global IDs, operation list, `planChecksum`, and `manifestChecksum`. Obtain explicit approval for that exact fresh plan.

```sh
yarn workspace functions cleanup:tournament-import --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N --repair-id REPAIR_ID --as-of 2026-08-20T00:00:00.000Z --commit --allow-primary --primary-confirm cleanup-imported-participants-on-default --confirm clear-imported-participants-qzhR8w2Zs7MNUtlycL9N-from-default --expected-checksum PLAN_CHECKSUM
```

The commit aborts if any file checksum drifted. Reports are written under `functions/release-reports/` and are intentionally not committed.

## Validate and prepare reverse

```sh
yarn workspace functions cleanup:tournament-import:validate --database '(default)' --tournament qzhR8w2Zs7MNUtlycL9N --repair-id REPAIR_ID --expect-writes disabled --expected-manifest-checksum MANIFEST_CHECKSUM --allow-primary-read-only

yarn workspace functions cleanup:tournament-import:reverse --database '(default)' --repair-id REPAIR_ID --allow-primary-read-only
```

If validation fails before re-import, keep maintenance enabled. Reverse only with the checksum from the latest reverse dry-run; reverse refuses any post-cleanup drift. Retired Global IDs and the counter high-water mark remain preserved by design.

```sh
yarn workspace functions cleanup:tournament-import:reverse --database '(default)' --repair-id REPAIR_ID --commit --allow-primary --primary-confirm reverse-import-cleanup-on-default --confirm reverse-REPAIR_ID --expected-manifest-checksum REVERSE_MANIFEST_CHECKSUM
```

## Controlled re-import

Allow only the target tournament import while all other writes remain disabled.

```sh
yarn workspace functions maintenance:write-control --database '(default)' --disabled --allow-operation tournament.import:qzhR8w2Zs7MNUtlycL9N --allow-primary --primary-confirm change-default-write-control --actor production-import-reload
```

Preview the recorded final workbook, verify its displayed workbook SHA-256 and plan checksum, then commit from the UI. Submit the same file again with a new client operation ID and confirm `idempotentReplay=true` with unchanged profile, registration, and team counts.

Remove the import exception, run data and UI smoke checks, then restore writes.

```sh
yarn workspace functions maintenance:write-control --database '(default)' --disabled --allow-primary --primary-confirm change-default-write-control --actor production-import-verification

yarn workspace functions maintenance:write-control --database '(default)' --enabled --allow-primary --primary-confirm change-default-write-control --actor production-import-complete
```

If a forward fix is not safe after re-import, keep maintenance enabled and restore from the managed export; do not use the pre-import reverse manifest after new production writes.
