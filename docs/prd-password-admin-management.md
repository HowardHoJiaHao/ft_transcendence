# PRD: Password Change and Minimal Admin Management

## Summary

Add a small, 42-school-focused user-management feature set that demonstrates:

- Standard user management through OTP-protected password changes.
- Advanced permissions through separate member and administrator access.
- Administrator control through user suspension and restoration.

This is an academic MVP. Production-oriented session systems, audit logs,
analytics, permanent deletion, and broader marketplace moderation are outside
the intended scope.

## Goals

- Allow an authenticated member to change their password after verifying their
  current password and an email OTP.
- Provide a separate administrator login and a minimal user-management page.
- Allow the administrator to view, suspend, and restore member accounts.
- Block suspended members from logging in or using protected endpoints.
- Preserve all member data when an account is suspended.

## Existing Project Context

The project already provides registration, bcrypt password hashing, JWT
authentication, email OTP verification during login, profile management, and
protected marketplace routes. One ordinary account can act as both a buyer and
a seller.

The new work should reuse these existing patterns and remain small enough to be
demonstrated clearly during a 42 evaluation.

## Functional Requirements

### 1. Password change with OTP

Add a password-change option to the member profile or account settings.

The member must enter:

- Their current password.
- A new password.
- Confirmation of the new password.

The flow is:

1. The backend identifies the member from their JWT.
2. The backend verifies the current password with bcrypt.
3. If it is correct, the backend sends an OTP to the member's registered email.
4. The member submits the OTP.
5. The backend validates the OTP and applies the existing password-strength
   rules to the new password.
6. The backend hashes and stores the new password.
7. The frontend removes the member's local authentication data and redirects
   them to the login page.

Required endpoints:

```http
POST /api/v1/auth/change-password/request
POST /api/v1/auth/change-password/confirm
```

The existing OTP table and email helpers should be reused. Purpose-specific OTP
tables, recovery codes, and advanced OTP infrastructure are not required.

### 2. Minimal administrator authentication

Add these frontend pages:

```text
/admin/login
/admin/users
```

Administrator credentials will be provided through environment variables:

```text
ADMIN_USERNAME
ADMIN_PASSWORD_HASH
```

`ADMIN_PASSWORD_HASH` should contain a bcrypt hash. For easier local MVP
testing, the backend also accepts a plaintext test password in this variable.
Successful authentication returns a JWT containing an explicit administrator
role. The administrator is then redirected to `/admin/users`.

Administrator authorization must be checked by the backend. A hidden frontend
button or route redirect alone is not sufficient.

The administrator identity is environment-backed and is not a record in the
`users` table.

### 3. User list

The administrator users page displays:

| Field | Required |
| --- | --- |
| User ID | Yes |
| Username | Yes |
| Email | Yes |
| Account status | Yes |
| Suspend or restore action | Yes |

Search, analytics, listing counts, sales data, and detailed filters are not
required.

Required endpoint:

```http
GET /api/v1/admin/users
```

### 4. Suspend and restore members

Add an `account_status` field to `users` with these supported values:

```text
active
suspended
```

New registrations always receive `active` status. Clients cannot choose or
change their own account status.

Required endpoint:

```http
PATCH /api/v1/admin/users/:id/status
```

The endpoint accepts only `active` or `suspended`. The administrator can:

- Suspend an active member.
- Restore a suspended member.

Suspended members must be rejected:

- During login.
- When using a JWT issued before suspension on any protected route.

The existing JWT middleware should load the member from the database and check
that `account_status` is `active`. This central check blocks profile editing,
listing changes, ordering, messaging, and other protected actions without
duplicating the rule in every handler.

Suspension must preserve:

- The user profile.
- Listings and listing images.
- Orders.
- Messages and friendships.
- Avatars and other uploaded files.

Restoring the member allows them to log in and use protected features again.

## Authorization and Responses

- Missing or invalid authentication returns `401 Unauthorized`.
- A normal authenticated member calling an administrator endpoint returns
  `403 Forbidden`.
- A suspended member calling a protected endpoint returns `403 Forbidden`.
- Invalid request data returns `400 Bad Request`.
- Incorrect current password or invalid/expired OTP must not change the
  password.
- Administrator middleware must validate the administrator role from the
  signed JWT.

## Acceptance Criteria

- A logged-in member can start the password-change flow only with the correct
  current password.
- A correct current password causes an OTP to be sent to the registered email.
- An incorrect or expired OTP cannot change the password.
- The new password and its confirmation must match.
- The existing password policy is applied to the new password.
- The new password is stored as a bcrypt hash.
- After success, the old password fails and the new password works.
- The frontend logs the member out after a successful password change.
- Valid administrator credentials can open `/admin/users`.
- Unauthenticated users and ordinary members cannot use administrator
  endpoints.
- The administrator can list members, suspend an active member, and restore a
  suspended member.
- Suspended members cannot log in.
- Suspended members with an existing JWT cannot use protected routes.
- Suspending a member does not delete their related data or uploaded images.
- Restored members can log in and use protected routes again.

## Validation

Run the narrowest relevant project checks:

```bash
cd backend
go test ./...
go build ./...
```

```bash
cd frontend
npm run build
```

Add focused backend tests for password verification, OTP confirmation,
administrator authorization, and suspended-account enforcement where practical.

## Out of Scope

- Permanent user deletion and file cleanup.
- Administrator username moderation.
- Audit logs and suspension reasons.
- User activity analytics and complex search filters.
- Multiple administrator levels.
- Per-device sessions and server-side logout.
- Forgotten-password recovery.
- Listing and order moderation.
- Administrator promotion from the normal registration flow or dashboard.

## Assumptions

- One ordinary member can act as both buyer and seller.
- The administrator is authenticated using environment-backed credentials and
  is not stored in the `users` table.
- The existing login OTP implementation can be reused for password changes
  without introducing a new OTP subsystem.
- This feature is intended to demonstrate user management and permissions for a
  42-school evaluation, not to provide production-grade identity management.
