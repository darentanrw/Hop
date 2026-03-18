# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Hop is a privacy-first NUS campus rideshare PWA. It is a pnpm monorepo with three packages:

- `apps/web` — Next.js 16 App Router (port 3000)
- `services/matcher` — Express 5 confidential matcher (port 4001)
- `packages/shared` — shared types, constants, and validation

### Running services

Three services must be running for the app to work end-to-end:

1. **Convex** — run `pnpm convex:dev` in `apps/web` (or `npx convex dev`). This syncs functions and generates types. Log in when prompted.
2. **Next.js** — `pnpm dev:web` (port 3000)
3. **Matcher** — `pnpm dev:matcher` (port 4001)

Start Convex first so `convex/_generated` is created before building.

### Lint / Test / Build

- `pnpm lint` — runs Biome check
- `pnpm test` — runs Vitest (unit tests in `apps/web/tests/` and `services/matcher/src/`)
- `pnpm build` — builds shared → web → matcher in order

### OTP email in dev

OTP emails are sent via Resend when `AUTH_RESEND_KEY` is set. Without the key, OTP codes are logged to the Convex dashboard / server console. The OTP code is never returned in the API response.

### Environment

- **Next.js** (`apps/web/.env.local`): Copy from `apps/web/.env.example`. `NEXT_PUBLIC_CONVEX_URL` is set by `npx convex dev`.
- **Matcher** (`services/matcher/.env`): Copy from `services/matcher/.env.example`.
- **Convex** (Convex dashboard or `npx convex env set`): See `apps/web/.env.convex.example` and README.

### Pre-push hooks

Husky pre-push hook runs `biome check .` and `pnpm test`. Both must pass before pushing.
