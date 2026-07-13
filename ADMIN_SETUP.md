# Administrator setup

The website now uses Firebase Email/Password Authentication and a Firestore
administrator allowlist. Complete these steps once in the Firebase project
`fred-meeting-schedule`.

## 1. Enable Email/Password sign-in

In Firebase Console, open **Authentication > Sign-in method**, enable
**Email/Password**, and save.

## 2. Create an administrator account

Open **Authentication > Users**, add the administrator's email and password,
then copy the user's **UID**.

## 3. Approve the UID

In Firestore, create this document:

```text
Collection: admins
Document ID: <the Firebase Authentication UID>
Field: enabled = true (boolean)
```

Repeat steps 2 and 3 for every person who should be allowed to edit. Removing
the `admins/{uid}` document, or changing `enabled` to `false`, removes that
person's administrator access.

## 4. Deploy the security rules

From this directory, after signing in with Firebase CLI, run:

```powershell
firebase deploy --only firestore:rules
```

Deploying `firestore.rules` is required. The UI's read-only mode improves the
experience, while Firestore Security Rules provide the actual data protection.

## Resulting permissions

- Everyone can view, search, change weeks, and inspect summary categories.
- Everyone can use **My turn** and **End turn**.
- Only approved administrators can edit schedule cells, locations, students,
  notes, statuses, closed blocks, or clear a week.
- Administrator accounts can only be approved or revoked in Firebase Console;
  the public website has no self-registration flow.
