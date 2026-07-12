# Daily Mindset Builder Deployment Checklist

## 1. Firebase Project Setup

- Create a Firebase project.
- Enable Authentication > Sign-in method > Email/Password.
- Enable Firestore Database in production mode.
- Create a Web App in Firebase and copy the web config.

## 2. App Configuration

- Update `firebase-config.js` with your real Firebase web config values.
- Do not leave placeholder values in production.
- Optionally set the config dynamically via runtime injection to avoid environment drift.

## 3. Firestore Security Rules

- Deploy rules from `firestore.rules`.
- Confirm users can only read/write their own documents under `users/{uid}`.

## 4. Firebase CLI Deployment

- Install Firebase CLI.
- Run `firebase login`.
- Set project alias in `.firebaserc`.
- Deploy rules and hosting:
  - `firebase deploy --only firestore:rules`
  - `firebase deploy --only hosting`

## 5. Production Validation Scenarios

- Sign up with email/password and receive verification email.
- Verify email, then log in.
- Trigger password reset email.
- Save user data across pages (journal, mood, gratitude, goals, quotes, settings).
- Log in on a second device and verify data appears.
- Log out and verify data is not deleted.
- Clear browser storage and confirm account still exists in Firebase and data restores after login.

## 6. Observability and Hardening

- Enable Firebase Auth email templates and domain branding.
- Monitor Firebase Authentication and Firestore usage/quotas.
- Add rate limiting and abuse protection for API endpoints.
- Add backup/export policy for Firestore.

## 7. Launch Readiness Gate

- No placeholder Firebase config values.
- Rules deployed and tested.
- Multi-device login verified.
- Local migration to Firestore verified for existing users.
- Rollback plan documented.
