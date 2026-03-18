# Hop

Privacy-first NUS campus rideshare, implemented as a web-first PWA plus a separate matcher service.

## What is implemented

- `apps/web`: Next.js App Router app for OTP login, preferences, private availability submission, tentative groups, acknowledgements, and address reveal
- `services/matcher`: separate matcher service that receives plaintext addresses, stores only sealed destination blobs in memory, returns opaque refs, computes compatibility, and releases encrypted address envelopes
- `packages/shared`: shared types and constants
- Prisma schema scaffold for a production Postgres-backed version

## Privacy boundary

- The main web app backend never accepts plaintext addresses.
- The browser submits exact addresses directly to the matcher service.
- The web app stores only opaque destination refs and route descriptor refs.
- Revealed addresses are encrypted to each rider's browser public key and only decrypted in the browser after unanimous acknowledgement.

## Local development

1. Copy `.env.example` to `.env`.
2. Install dependencies:
   - `pnpm install`
3. Run the matcher service:
   - `pnpm dev:matcher`
4. Run the web app:
   - `pnpm dev:web`
5. Open the web app at `http://localhost:3000`.

## Notes

- OTP uses a dev-only response field so you can log in locally without email infrastructure.
- The data layer is currently an in-memory beta scaffold so the app can run from an empty repo today.
- `apps/web/prisma/schema.prisma` models the intended production Postgres schema.
- The matcher service intentionally uses coarse route heuristics for the prototype instead of true road-network routing.

