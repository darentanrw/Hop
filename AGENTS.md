# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Hop is a privacy-first NUS campus rideshare PWA. It is a pnpm monorepo with three packages:

- `apps/web` — Next.js 16 App Router (port 3000)
- `services/matcher` — Express 5 confidential matcher (port 4001)
- `packages/shared` — shared types, constants, and validation

### Running services

Both services must be running for the app to work end-to-end. See `package.json` root scripts:

- `pnpm dev:web` — starts the Next.js web app on port 3000
- `pnpm dev:matcher` — starts the matcher service on port 4001

No database or Redis is needed for local dev — both services use in-memory stores.

### Lint / Test / Build

- `pnpm lint` — runs Biome check
- `pnpm test` — runs Vitest (unit tests in `apps/web/tests/` and `services/matcher/src/`)
- `pnpm build` — builds shared → web → matcher in order

### OTP email in dev

OTP emails are sent via Resend when `RESEND_API_KEY` is set. Without the key, OTP codes are logged to the Next.js server console (`[dev] OTP for <email>: <code>`). The OTP code is never returned in the API response.

### Environment

Copy `.env.example` to `.env`. Key variables:

- `RESEND_API_KEY` — Resend API key for sending OTP emails (optional in dev)
- `RESEND_FROM_EMAIL` — sender address (defaults to `Hop <noreply@hop.sg>`)
- `MATCHER_BASE_URL` / `NEXT_PUBLIC_MATCHER_BASE_URL` — matcher service URL (default `http://localhost:4001`)

### Pre-push hooks

Husky pre-push hook runs `biome check .` and `pnpm test`. Both must pass before pushing.
