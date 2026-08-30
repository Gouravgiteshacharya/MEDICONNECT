# MediConnect Platform Core Integration Contract

This document defines how other MediConnect backend modules should use the Platform Core.

## 1. API Conventions

- All current backend routes are mounted under `/api/v1`.
- Public JSON payloads currently use `camelCase`.
- Standardized errors use `{ "error": "...", "code": "..." }`.
- Do not introduce a second API versioning pattern without coordinated review.
- General JSON request bodies are limited to `100kb`. Large files such as prescriptions or images must use a future upload/storage flow instead of larger JSON payloads.

## 2. Authentication

Use `authenticate` before protected handlers.

After successful authentication:

```ts
req.user = {
  id,
  role,
};
```

- `id` is the current authenticated `User.id`.
- `role` is the current database `UserRole`.
- Downstream modules must not decode JWTs themselves.
- Downstream modules must not trust request-body roles.
- Downstream modules must not trust stale JWT role claims over `req.user.role`.

## 3. Global Authorization

Use `authorizeRoles(...allowedRoles)` after `authenticate`.

Expected composition:

```ts
authenticate,
authorizeRoles(UserRole.PHARMACY_STAFF),
controller
```

- Missing authenticated identity returns `401 AUTH_REQUIRED`.
- Authenticated users without an allowed global role return `403 FORBIDDEN`.
- `ADMIN` is not an implicit bypass. Include `UserRole.ADMIN` explicitly if a route should allow admins.
- `authorizeRoles()` with no allowed roles denies access.

## 4. Pharmacy Membership

Platform Core provides:

- `authenticate`
- `authorizeRoles(UserRole.PHARMACY_STAFF)`
- `getActivePharmacyMembership(userId, pharmacyId)`

`UserRole.PHARMACY_STAFF` alone does not prove access to a particular pharmacy. Pharmacy Network modules must resolve active membership for the current `userId + pharmacyId` and then apply their own business permission rules.

Suggested sequence:

```text
authenticate
authorizeRoles(UserRole.PHARMACY_STAFF)
resolve active userId + pharmacyId membership
apply Pharmacy Network business permission
```

Pharmacy Network owns pharmacy ownership policies, inventory authorization, catalogue authorization, and which `PharmacyStaffRole` may perform each pharmacy action.

## 5. Profile And Addresses

Platform Core owns:

- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me`
- `GET /api/v1/users/me/addresses`
- `POST /api/v1/users/me/addresses`
- `PATCH /api/v1/users/me/addresses/:addressId`
- `DELETE /api/v1/users/me/addresses/:addressId`

These routes are self-service only. They do not provide arbitrary user lookup, arbitrary user address administration, checkout address selection, order snapshots, delivery quotes, or geocoding.

## 6. Validation

Use `validateRequest` at the route boundary.

- It supports `body`, `params`, and `query`.
- It assigns parsed and normalized Zod output back to the request.
- Use `uuidSchema` for UUID route params.
- Use strict schemas for security-sensitive create/update inputs.
- Do not pass `req.body` directly into Prisma writes; construct write objects explicitly.
- Domain modules should keep their own domain schemas in their module, while reusing shared primitives when helpful.

## 7. Errors

Current shared error codes:

| Status | Code | When to use or expect |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod validation failed for body, params, or query. |
| 400 | `MALFORMED_JSON` | JSON body parsing failed. |
| 401 | `AUTH_REQUIRED` | A protected route has no authenticated identity. |
| 401 | `INVALID_TOKEN` | JWT is invalid, stale, malformed, or no longer maps to a current user. |
| 401 | `INVALID_CREDENTIALS` | Login email/password did not match. |
| 401 | `ACCOUNT_INACTIVE` | The user exists but is inactive. |
| 403 | `FORBIDDEN` | Authenticated identity lacks the required permission. |
| 404 | `ROUTE_NOT_FOUND` | No API route matched. |
| 404 | `ADDRESS_NOT_FOUND` | Saved address is nonexistent or not owned by the current user. |
| 409 | `EMAIL_ALREADY_EXISTS` | Email uniqueness conflict. |
| 409 | `PHONE_ALREADY_EXISTS` | Phone uniqueness conflict. |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body exceeds the global body limit. |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected internal failure. |

Expected business/client errors should become `ApiError` or flow through established safe translations. Unexpected internal errors should reach the global error handler.

Do not expose Prisma internals, SQL, JWT library errors, Zod internals, stack traces, secrets, database URLs, or raw request bodies.

## 8. Prisma And Database Use

- Use the shared Prisma client from Platform Core.
- Do not create a new `PrismaClient` per request.
- Do not modify the shared Prisma schema casually from feature branches.
- Schema changes require coordinated review and migration workflow.
- Do not run destructive database commands against shared development data.

## 9. Module Ownership Boundaries

Commerce and Prescription modules own cart ownership, order ownership, checkout authorization, prescription ownership, pharmacy review authorization, and the human prescription decision workflow. AI must not approve prescriptions, and Platform Core does not provide clinical authorization.

Delivery and Logistics owns delivery-partner profile resolution where needed, assignment ownership, rider availability policies, delivery state transitions, tracking authorization, and logistics rules. Platform Core only provides authentication, global role checks, validation, and shared errors.

Intelligence and Experience modules consume deterministic APIs. They must not bypass authentication, deterministic business rules, pharmacy authorization, prescription human-review rules, or order/delivery ownership rules.

## 10. Security And Deployment Notes

- Helmet is enabled globally.
- CORS remains development-permissive until deployment origin configuration is finalized.
- Rate limiting is deferred to deployment/infrastructure design.
- `trust proxy` is not enabled without deployment topology.
- CSRF requirements must be revisited if authentication later moves from Bearer JWTs to cookies.
