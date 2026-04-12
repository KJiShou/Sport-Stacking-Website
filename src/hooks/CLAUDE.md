[Root Directory(../../CLAUDE.md) > [src/](../) > **Hooks**

---

# Hooks Module

**Path**: `src/hooks/`

**Responsibility**: Custom React hooks and barrel re-exports. This module is minimal -- most hooks live in utility directories.

---

## Entry Points

| Path | Purpose |
|------|---------|
| `src/hooks/index.js` | Barrel re-export of device-related hooks from `src/utils/DeviceInspector/` |

---

## Exported Hooks

| Hook | Source | Purpose |
|------|--------|---------|
| `useDeviceNetworkStatus` | `utils/DeviceInspector` | Monitor online/offline state |
| `useDeviceLanguage` | `utils/DeviceInspector` | Detect user language/locale |
| `useDeviceBreakpoint` | `utils/DeviceInspector` | Reactive screen size breakpoint (xs/sm/md/lg/xl) |
| `useDeviceOrientation` | `utils/DeviceInspector` | Detect portrait/landscape |
| `useSmartDateHandlers` | `hooks/DateHandler/useSmartDateHandlers.ts` | Tournament date picker smart defaults |

---

## useSmartDateHandlers

**File**: `src/hooks/DateHandler/useSmartDateHandlers.ts`

A form helper hook for smart date range handling in tournament creation:

- **`handleTournamentDateChange`**: When tournament date range changes:
  - Auto-sets start time to 08:00 if midnight (default)
  - Auto-sets end time to 18:00 if midnight
  - Computes registration window: 1 month before tournament start to 14 days before tournament end
  - Auto-fills `registration_date_range` only if currently empty
  - Falls back to today if registration start would be in the past

- **`handleRangeChangeSmart`**: Generic date range field setter that enforces 08:00 start / 18:00 end defaults for any date field.

**Used by**: `src/pages/Tournaments/CreateTournaments/CreateTournaments.tsx`

---

## Important Note

The `hooks/index.js` file is a **JavaScript** file (not TypeScript), which is a legacy entry point. The hooks themselves are TypeScript. This is part of the project's TS/JS migration -- the `index.js` barrel exists for compatibility with the Vite build configuration.

---

## DeviceInspector Module Location

The device-related hooks are **not** in `src/hooks/` -- they live in `src/utils/DeviceInspector/`. The `hooks/index.js` barrel just re-exports them. This is a minor organizational inconsistency.

---

## FAQ

**Q: Why are device hooks in utils instead of hooks/?**
A: The device hooks were placed in `utils/DeviceInspector/` rather than `hooks/`. The barrel file at `hooks/index.js` re-exports them for convenience, but the canonical location is `utils/DeviceInspector/`.

**Q: Why is `hooks/index.js` a `.js` file instead of `.ts`?**
A: It appears to be part of the TS migration process. The barrel file may have been written in JS before the directory was fully migrated to TypeScript.

---

## Related Files

- Device inspector: `src/utils/DeviceInspector/` (actual implementation)
- Tournament date form: `src/pages/Tournaments/CreateTournaments/CreateTournaments.tsx`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Barrel structure, exported hooks, and `useSmartDateHandlers` details captured. |