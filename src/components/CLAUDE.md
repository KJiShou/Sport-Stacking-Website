[Root Directory(../../CLAUDE.md) > [src/](../) > **Components**

---

# Components Module

**Path**: `src/components/`

**Responsibility**: Reusable UI building blocks and layout wrappers. Components are organized by domain: `common/` (auth and security), `layout/` (site chrome).

---

## Common Components

| Component | File | Purpose |
|-----------|------|---------|
| **Login** | `common/Login.tsx` | Login form (email/password + Google OAuth) -- renders in modal/drawer |
| **AvatarUploader** | `common/AvatarUploader.tsx` | Avatar upload with Firebase Storage + Firestore profile update |
| **ProtectedRoute** | `common/ProtectedRoute.tsx` | Route guard showing full-screen spinner while auth is loading |

---

## Layout Components

| Component | File | Purpose |
|-----------|------|---------|
| **Navbar** | `layout/Navbar.tsx` | Top navigation bar with menu, user avatar, pending verification badge, login modal trigger |
| **Footer** | `layout/Footer.tsx` | Site footer with address, phone, WhatsApp, email, Facebook links |
| **index** | `layout/index.ts` | Barrel export |

---

## Key Implementation Details

### Login Component
- Email/password sign-in via `signInWithEmailAndPassword` (authService)
- Google OAuth via `signInWithPopup`
- Sign-out via `logout`
- Renders in a modal/drawer triggered by Navbar
- Shows login form only when `firebaseUser` is null

### AvatarUploader
- Uses Arco Design `Upload` component with `customRequest`
- Uploads file to Firebase Storage path `avatars/{userId}/`
- Updates `users/{userId}` Firestore document with `image_url` field
- Triggers page reload after successful upload (`window.location.reload()`)

### ProtectedRoute
- Uses `useAuthContext()` to check `loading` state
- Shows a full-screen centered `Spin` overlay during auth loading
- Once loaded, renders children unconditionally (auth check is done via routes configuration)

### Navbar
- Horizontal menu with `Menu` component
- Highlights current route via `selectedKeys` (uses `location.pathname + search` for tournaments/records)
- Shows real-time pending verification count badge (via `subscribePendingVerificationCount`)
- Contains inline `LoginForm` modal trigger
- User avatar with dropdown menu (Profile, Logout)
- Fixed position at top of viewport

### Footer
- Static content with physical address, phone numbers, social links
- Custom WhatsApp SVG icon (inline)
- Grid layout using Arco Design `Grid` (Row/Col)

---

## Design System

- **UI Library**: Arco Design React
- **Styling**: Tailwind CSS + inline styles (mixed)
- **Icon Library**: `@arco-design/web-react/icon`
- **No component library pattern** -- components are hand-crafted TSX, not compound components with a design system wrapper

---

## FAQ

**Q: Why is the Login component in `common/`?**
A: It is used across multiple pages as a modal/drawer overlay triggered by the Navbar. It is not part of the layout chrome itself.

**Q: Does ProtectedRoute check if the user is authenticated?**
A: No -- it only waits for the auth loading state. Actual authentication enforcement is done via route configuration in `src/config/routes.tsx` using role-based checks in page components.

**Q: How does the Navbar handle auth state changes?**
A: `firebaseUser` from `AuthContext` controls visibility of login vs. user menu. `user` (Firestore profile) provides `global_id` for role checks and verification count subscription.

---

## Related Files

- Auth context: `src/context/AuthContext.tsx`
- Auth service: `src/services/firebase/authService.ts`
- Route config: `src/config/routes.tsx`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Component inventory, Navbar auth flow, and Footer layout documented. |