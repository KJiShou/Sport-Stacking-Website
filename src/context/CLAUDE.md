[Root Directory](../CLAUDE.md) > **Auth Module**

---

# Auth Module

**Path**: `src/context/AuthContext.tsx` + `src/services/firebase/authService.ts` + `src/components/common/Login.tsx` + `src/components/common/ProtectedRoute.tsx` + `src/pages/User/`

**Responsibility**: Firebase Authentication integration, Firestore user profile loading, route protection, and auth UI pages.

---

## Entry Points

| Page | Route | File |
|------|-------|------|
| Register | `/register` | `src/pages/User/Register/RegisterPage.tsx` |
| Forgot Password | `/forgot-password` | `src/pages/User/ForgotPassword/ForgotPasswordPage.tsx` |
| User Profile | `/users/:id` | `src/pages/User/UserProfile/UserProfile.tsx` |

---

## Auth Context (`src/context/AuthContext.tsx`)

```typescript
type AuthContextValue = {
  user: FirestoreUser | null;    // From Firestore "users" collection
  firebaseUser: User | null;     // From Firebase Auth
  loading: boolean;
  setUser: (user: FirestoreUser | null) => void;
};

// Flow:
// 1. onAuthStateChanged -> firebaseUser
// 2. If firebaseUser exists, fetch Firestore user doc by UID
// 3. Set loading=false when done
```

### Auth Flow Notes
- Google Sign-In users who only have `google.com` provider (no password) are redirected to `/register` to complete their profile
- Google Sign-In users are logged out when navigating away from `/register` to prevent account mixing
- Google avatars are cached to Firebase Storage via `cacheGoogleAvatarCallable` Cloud Function

---

## ProtectedRoute (`src/components/common/ProtectedRoute.tsx`)

- Wraps all authenticated routes
- Shows loading spinner while `loading === true`
- Redirects to `/` if `firebaseUser` is null (not authenticated)

---

## Firestore User Document

```typescript
type FirestoreUser = {
  id: string;              // Firebase Auth UID
  global_id: string;       // Business identifier (used across collections)
  memberId: string;
  name: string;
  IC: string;              // 12-digit IC number
  email: string;
  phone_number?: string;
  birthdate: Timestamp;
  gender: "Male" | "Female";
  country: string[];
  image_url: string;
  school?: string;
  best_times: Record<string, {time: number; updated_at: Timestamp; season: string}>;
  roles?: Role;            // Admin permissions
  registration_records: UserRegistrationRecord[];
};
```

---

## Roles

| Role | Description |
|------|-------------|
| `edit_tournament` | Create and edit tournaments |
| `record_tournament` | Enter scores for tournaments |
| `modify_admin` | Manage user roles and permissions |
| `verify_record` | Verify submitted records |

---

## FAQ

**Q: How does Google Sign-In work?**
A: Firebase Auth handles Google OAuth. After sign-in, the `AuthContext` fetches the Firestore user document. If the user was created via Google (no password provider), they are forced to `/register` to fill in profile data (IC, birthdate, country, etc.).

**Q: Why are Google-only users logged out when leaving `/register`?**
A: To prevent mixing a Google account with a password-based account. The user must complete registration first, then log in normally.

---

## Related Files

- Schema: `src/schema/UserSchema.ts`, `src/schema/RoleSchema.ts`, `src/schema/AuthSchema.ts`
- Services: `src/services/firebase/authService.ts`
- Cloud Functions: `functions/src/index.ts` (`cacheGoogleAvatarCallable`)

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Auth flow, Firestore user shape, role definitions, and Google Sign-In quirks documented. |
