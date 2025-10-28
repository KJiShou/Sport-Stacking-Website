# User Best Times Feature

## Overview
This feature automatically tracks and updates each user's best times for individual stacking events. When a user achieves a new personal record in any event (3-3-3, 3-6-3, Cycle, or Overall), the system automatically updates their best times.

## Schema Changes

### User Schema (`src/schema/UserSchema.ts`)
Added `best_times` field to the `FirestoreUserSchema`:

```typescript
best_times: z
    .object({
        "3-3-3": z.number().optional().nullable(),
        "3-6-3": z.number().optional().nullable(),
        Cycle: z.number().optional().nullable(),
        Overall: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
```

This field stores the user's best (lowest) time for each event type:
- **3-3-3**: Best time for the 3-3-3 event
- **3-6-3**: Best time for the 3-6-3 event
- **Cycle**: Best time for the Cycle event
- **Overall**: Best overall time (sum of 3-3-3 + 3-6-3 + Cycle, or from an overall record)

## Frontend Services

### User Best Times Service (`src/services/firebase/userBestTimesService.ts`)

#### Functions

##### `updateUserBestTime(globalId: string, eventType: EventType, newTime: number): Promise<boolean>`
Updates a user's best time for a specific event if the new time is better than the current record.

**Parameters:**
- `globalId`: The user's global_id
- `eventType`: One of "3-3-3", "3-6-3", "Cycle", or "Overall"
- `newTime`: The new time to compare

**Returns:** `true` if the best time was updated, `false` otherwise

##### `updateUserOverallBestTime(globalId: string): Promise<boolean>`
Recalculates and updates the user's Overall best time based on the sum of their 3-3-3, 3-6-3, and Cycle best times.

**Parameters:**
- `globalId`: The user's global_id

**Returns:** `true` if the Overall best time was updated, `false` otherwise

##### `updateUserBestTimes(globalId: string, times: Partial<Record<EventType, number>>): Promise<void>`
Batch updates best times for multiple events and recalculates Overall if needed.

**Parameters:**
- `globalId`: The user's global_id
- `times`: Object containing event types and their best times

### Record Service Updates (`src/services/firebase/recordService.ts`)

#### Modified Functions

##### `saveRecord(data: TournamentRecord): Promise<string>`
Now automatically updates the user's best time after saving a record. The function:
1. Saves the record to Firestore
2. Extracts the event type from the event name
3. Calls `updateUserBestTime()` to update the user's best time if applicable
4. Returns the record ID

##### `saveOverallRecord(data: TournamentOverallRecord): Promise<string>`
Now automatically updates the user's best times for all component events and overall. The function:
1. Saves the overall record to Firestore
2. Updates best times for 3-3-3, 3-6-3, and Cycle if they exist in the record
3. Updates the Overall best time
4. Recalculates the Overall best time from components
5. Returns the record ID

## Backend Cloud Functions

### `updateUserBestTimes` (`functions/src/index.ts`)
Triggers when a document in the `records` collection is created or updated.

**Trigger:** `records/{recordId}`

**Logic:**
1. Extracts participant global_id and best_time from the record
2. Determines the event type from the event name
3. Compares with the user's current best time
4. Updates if the new time is better
5. Recalculates Overall best time if one of the component events (3-3-3, 3-6-3, Cycle) was updated

### `updateUserBestTimesFromOverall` (`functions/src/index.ts`)
Triggers when a document in the `overall_records` collection is created or updated.

**Trigger:** `overall_records/{recordId}`

**Logic:**
1. Extracts participant global_id and all event times from the overall record
2. Compares each event time (3-3-3, 3-6-3, Cycle, Overall) with the user's current best
3. Updates any times that are better than the current bests
4. Performs batch update for efficiency

## How It Works

### Flow Diagram

```
User submits a record
        ↓
Frontend: saveRecord() or saveOverallRecord()
        ↓
Record saved to Firestore
        ↓
Frontend: updateUserBestTime() called
        ↓
Compare new time with current best time
        ↓
If better → Update user's best_times field
        ↓
If component event updated → Recalculate Overall
        ↓
Backend Cloud Function (backup)
        ↓
Triggers on record write
        ↓
Double-checks and updates best times
```

### Example Scenarios

#### Scenario 1: New 3-3-3 Record
1. User completes 3-3-3 event with time: 2.50s
2. Current best time in DB: 2.75s (or null)
3. System updates `best_times["3-3-3"]` to 2.50s
4. System checks if Overall can be recalculated
5. If 3-6-3 and Cycle best times exist, Overall is recalculated

#### Scenario 2: Overall Record Submission
1. User completes Overall event:
   - 3-3-3: 2.45s
   - 3-6-3: 3.10s
   - Cycle: 6.20s
   - Overall: 11.75s
2. System compares each time:
   - Updates 3-3-3 if 2.45s is better than current
   - Updates 3-6-3 if 3.10s is better than current
   - Updates Cycle if 6.20s is better than current
   - Updates Overall if 11.75s is better than current
3. Recalculates Overall from sum: 2.45 + 3.10 + 6.20 = 11.75s
4. Uses the better of submitted Overall or calculated Overall

#### Scenario 3: Slower Time
1. User completes Cycle event with time: 7.00s
2. Current best time in DB: 6.50s
3. System compares: 7.00s > 6.50s (slower)
4. No update is made
5. User's best time remains 6.50s

## Data Structure Example

```typescript
{
  id: "user123",
  global_id: "ATHLETE001",
  name: "John Doe",
  // ... other user fields
  best_times: {
    "3-3-3": 2.45,
    "3-6-3": 3.10,
    "Cycle": 6.20,
    "Overall": 11.75
  },
  updated_at: Timestamp
}
```

## Usage in Frontend Code

### When saving a single event record:
```typescript
import { saveRecord } from "@/services/firebase/recordService";

const record: TournamentRecord = {
  // ... record data
  participant_global_id: "ATHLETE001",
  event: "3-3-3",
  best_time: 2.45,
  // ... other fields
};

// This will automatically update best times
const recordId = await saveRecord(record);
```

### When saving an overall record:
```typescript
import { saveOverallRecord } from "@/services/firebase/recordService";

const overallRecord: TournamentOverallRecord = {
  // ... record data
  participant_global_id: "ATHLETE001",
  three_three_three: 2.45,
  three_six_three: 3.10,
  cycle: 6.20,
  overall_time: 11.75,
  // ... other fields
};

// This will automatically update all best times
const recordId = await saveOverallRecord(overallRecord);
```

### Manual best time update:
```typescript
import { updateUserBestTime, updateUserOverallBestTime } from "@/services/firebase/userBestTimesService";

// Update a specific event
await updateUserBestTime("ATHLETE001", "3-3-3", 2.45);

// Recalculate overall from components
await updateUserOverallBestTime("ATHLETE001");
```

## Error Handling

All best time update functions include error handling to ensure that:
1. Record saving never fails due to best time update errors
2. Errors are logged but don't block the main operation
3. The Cloud Function provides a backup mechanism if frontend updates fail

## Performance Considerations

- Updates are only performed when the new time is better than the current best
- Batch operations minimize Firestore writes
- Cloud Functions provide eventual consistency if frontend updates fail
- Only component event updates trigger Overall recalculation

## Security

The Cloud Functions run with admin privileges and bypass security rules. Frontend operations respect Firestore security rules and require:
- Valid user authentication
- Proper permissions to update user documents

## Testing

To test the feature:
1. Create a user record with no best times
2. Submit a record for any event
3. Verify `best_times` field is populated
4. Submit a better time
5. Verify best time is updated
6. Submit a slower time
7. Verify best time is NOT updated
8. Submit records for 3-3-3, 3-6-3, and Cycle
9. Verify Overall is calculated automatically

## Future Enhancements

Potential improvements:
- Add best times history tracking
- Include timestamps for when best times were achieved
- Add achievements/badges for breaking personal records
- Support team event best times
- Add leaderboards based on best times
- Export best times to athlete profiles
