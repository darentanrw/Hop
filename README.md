# Hop

Privacy-first NUS campus rideshare, implemented as a web-first PWA plus a separate matcher service.

## What is implemented

- `apps/web`: Next.js App Router app for OTP login, preferences, private availability submission, tentative groups, acknowledgements, and address reveal
- `services/matcher`: separate matcher service that receives plaintext addresses, stores only sealed destination blobs in memory, returns opaque refs, computes compatibility, and releases encrypted address envelopes
- `packages/shared`: shared types and constants
- Convex for database and auth (OTP via Resend, email reply verification)

## Privacy boundary

- The main web app backend never accepts plaintext addresses.
- The browser submits exact addresses directly to the matcher service.
- The web app stores only opaque destination refs and route descriptor refs.
- Revealed addresses are encrypted to each rider's browser public key and only decrypted in the browser after unanimous acknowledgement.

## Local development

1. Install dependencies: `pnpm install`
2. Set up environment variables:
   - **Next.js**: Copy `apps/web/.env.example` to `apps/web/.env.local`
   - **Matcher**: Copy `services/matcher/.env.example` to `services/matcher/.env`
3. Run Convex dev (creates project, syncs schema, sets `NEXT_PUBLIC_CONVEX_URL` in `apps/web/.env.local`):
   - `cd apps/web && npx convex dev`
4. Configure Convex environment variables (see [Convex Auth setup](#convex-auth-setup) below).
5. In separate terminals:
   - `pnpm dev:web` — Next.js app (port 3000)
   - `pnpm dev:matcher` — matcher service (port 4001)
6. Open the web app at `http://localhost:3000`.

## Convex Auth setup

Convex Auth requires several environment variables in your Convex deployment (not in `.env`). Set them via the [Convex dashboard](https://dashboard.convex.dev) or `npx convex env set`:

| Variable | Purpose | Required |
|----------|---------|----------|
| `SITE_URL` | Redirect URL after auth (e.g. `http://localhost:3000`) | Yes |
| `JWT_PRIVATE_KEY` | Private key for signing JWTs | Yes |
| `JWKS` | Public key set (JSON) for verifying JWTs | Yes |
| `AUTH_RESEND_KEY` | Resend API key for OTP, verification, and inbound emails | Yes |
| `RESEND_FROM_EMAIL` | Sender address (e.g. `Hop <login@hophome.app>`) | No (has default) |
| `RESEND_INBOUND_ADDRESS` | Inbound address that receives verification replies (e.g. `reply@xxx.resend.app`) | Yes, for email reply flow |

### Generating JWT keys

Run the key generator and paste the output into Convex dashboard → Deployment Settings → Environment Variables:

```bash
cd apps/web && pnpm convex:generate-keys
```

This uses the [jose](https://github.com/panva/jose) library to generate `JWT_PRIVATE_KEY` and `JWKS`.

### Setting variables via CLI

```bash
cd apps/web
npx convex env set SITE_URL http://localhost:3000
npx convex env set AUTH_RESEND_KEY re_your_resend_api_key
# JWT_PRIVATE_KEY and JWKS: use output from pnpm convex:generate-keys
```

Or copy `apps/web/.env.convex.example` to `apps/web/.env.convex`, fill in values, then run:

```bash
cd apps/web && npx convex env set --from-file .env.convex
```

## Production deployment

The production site should use a **deployed Convex production deployment**, not `npx convex dev`.

### One-time setup

1. Create a Convex production deployment for this project:
   ```bash
   cd apps/web
   pnpm convex:deploy
   ```
2. Set the production Convex env vars:
   ```bash
   cd apps/web
   npx convex env set --prod --from-file .env.convex
   ```
3. In Vercel, set these project environment variables:
   - `CONVEX_DEPLOY_KEY` — lets the production Vercel build run `convex deploy`
   - `NEXT_PUBLIC_MATCHER_BASE_URL` — public matcher base URL for the web app

### How production deploys work

- Preview deployments: Vercel runs a normal `next build`. Set `NEXT_PUBLIC_CONVEX_URL` in Vercel preview env if you want previews to connect to Convex.
- Production deployments: Vercel runs:
  ```bash
  pnpm exec convex deploy --cmd 'next build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
  ```
  This deploys Convex first, then injects the **production** Convex URL into the Next.js build automatically.

### GitHub Actions

The deploy workflow now:
- runs `lint`, `test`, and non-web package builds in CI
- deploys the web app from `apps/web`
- relies on Vercel's production build command to deploy Convex and build the site with the correct `NEXT_PUBLIC_CONVEX_URL`

## Resend Inbound (email reply verification)

For first-time users to verify by replying with the passphrase:

1. **Resend dashboard** → **Receiving** → **Add address**  
   Create inbound address `login@hophome.app` (add MX records Resend provides).

2. **Configure webhook**  
   - URL: `https://<your-deployment>.convex.site/resend-inbound`  
   - Event: `email.received`

3. **Set Convex env**  
   ```bash
   npx convex env set RESEND_INBOUND_ADDRESS login@hophome.app
   npx convex env set RESEND_FROM_EMAIL "Hop <login@hophome.app>"
   ```

## Notes

- Without `AUTH_RESEND_KEY`, OTP and verification emails will fail.
- The matcher service intentionally uses coarse route heuristics for the prototype instead of true road-network routing.
