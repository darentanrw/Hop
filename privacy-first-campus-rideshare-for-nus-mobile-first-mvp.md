# Privacy-First Campus Rideshare for NUS (Mobile-First MVP)

## Summary
Build a mobile-first rideshare app for a single campus launch at NUS, with a fixed pickup origin at Utown, university-email OTP login, anonymous group formation, and post-trip debt tracking.

The defining privacy requirement for this plan is:

- the normal backend and database never store or see plaintext home addresses
- addresses are revealed only after every matched rider explicitly acknowledges the group
- matching uses a confidential matching service plus pseudonymous group coordination, not plaintext address storage in the main app backend

This MVP supports:
- NUS email verification
- weekly availability windows such as “Friday 6pm–10pm”
- optional same-gender preference using self-declared gender
- group sizes of 2–4 riders
- automatic booker assignment
- equal cost splitting with manual payment confirmation
- soft enforcement with reminders, disputes, temporary suspension, and admin review

This MVP does **not** support:
- in-app payments
- multi-university tenancy
- arbitrary pickup origins
- public rider browsing/invites
- automatic permanent bans
- backend/plain DB storage of addresses

## Chosen Defaults and Assumptions
- Platform: native-feeling mobile app, implemented with `React Native + Expo + TypeScript`
- Campus scope: NUS only in v1
- Pickup origin: one fixed origin, `NUS Utown`
- Auth: OTP to an allowlist of university domains, initially `u.nus.edu` and `nus.edu.sg`, configurable
- Matching rule: anonymous candidate grouping first, exact addresses revealed only after unanimous acknowledgement
- Gender: optional self-declared profile field used only for preference filtering
- Booker assignment: automatic fair rotation based on reliability and prior assignments
- Payment handling: debt ledger only; actual money transfer happens outside the app
- Cost split: equal split among confirmed riders in v1
- Privacy boundary: the standard app backend must be address-blind; a separate confidential matching component may process addresses transiently in memory but must not persist plaintext addresses
- Map/privacy note: device geocoding should be preferred; if platform geocoding leaks queries to Apple/Google, that is outside the app backend privacy boundary and should be called out in product docs

## System Architecture

### 1. Client App
`apps/mobile`
- Handles onboarding, OTP login, device key generation, address entry, availability submission, acknowledgements, trip status, and payment/debt screens
- Generates and stores device key material in secure storage / keychain
- Keeps the user’s exact address locally until submission to the confidential matching service
- Decrypts revealed addresses only after unanimous group acknowledgement

### 2. Standard Backend API
`apps/api`
- Handles auth orchestration, user profiles, pseudonymous matching records, notifications, trip lifecycle, debt ledger, moderation state, and admin actions
- Must never receive plaintext addresses
- Stores user PII separately from rideshare/matching records
- Uses pseudonymous rider IDs in matching/trip tables

### 3. Confidential Matching Service
`services/confidential-matcher`
- Runs as a separate hardened service; recommended target is confidential computing such as `AWS Nitro Enclaves` in `ap-southeast-1`
- Receives exact destination data over attested channel
- Computes route similarity from fixed origin `NUS Utown`
- Stores only sealed ciphertext blobs outside enclave memory
- Releases address shares only after unanimous group acknowledgement
- Never writes plaintext address to logs, DB, queues, or analytics

### 4. Data Stores
- `PostgreSQL`: users, pseudonymous profiles, availability windows, groups, trips, debts, moderation actions, audit events
- `Redis`: OTP rate limits, ephemeral match queues, scheduled reminders, acknowledgement deadlines
- Object storage: receipts and booking screenshots, encrypted at rest
- Separate schemas or databases:
  - `identity` schema: email, verification status, device public keys
  - `rideshare` schema: pseudonymous rider ID, availability, groups, trips, debts
- Direct joins between identity and rideshare data should be limited to service-layer lookups only

### 5. Admin Surface
`apps/admin`
- Internal-only web console for reviewing disputes, suspensions, unpaid debts, and abuse flags
- Must never display addresses
- Displays only pseudonymous trip/group metadata unless a manual legal/safety escalation process is added later

## Privacy and Security Model

### Identity Separation
- On successful OTP verification, create:
  - `user_id` in identity domain
  - `rider_id` pseudonym in rideshare domain
- Matching/trip services use `rider_id`, not email
- Email and name never appear in match payloads sent to other riders

### Device Keys
Each mobile device generates:
- one `X25519` keypair for sealed address sharing
- one `Ed25519` keypair for signed acknowledgements and payment assertions

Store private keys in:
- iOS Keychain
- Android Keystore / secure storage abstraction

Backend stores only public keys plus device metadata.

### Address Handling
- Exact address is entered on the device
- Device geocodes locally where possible and sends exact address plus resolved coordinates only to the confidential matching service
- Standard backend receives only:
  - `rider_id`
  - time window
  - party size
  - self-declared gender
  - gender preference flags
  - availability state
  - opaque route/match fingerprint IDs produced by the confidential service

### Confidential Matching Service Rules
The confidential matching service must:
- keep plaintext destination/address only in enclave memory
- produce sealed destination escrow blobs for later reveal
- produce non-reversible match descriptors for the standard backend
- re-encrypt addresses to each confirmed rider’s device public key only after all riders acknowledge
- erase in-memory plaintext after each request

### Logging and Analytics Rules
- No plaintext address in logs, traces, analytics, crash reports, or admin tools
- No raw coordinate logging
- OTP events log domain and result only, not full email
- All security-sensitive events emit structured audit records with redacted payloads

## Matching and Group Formation Design

### Availability Model
Each rider can create one or more weekly availability entries:
- day of week
- start and end time
- desired party size range, default `2–4`
- self-declared gender
- optional same-gender-only preference
- optional note such as “no luggage” or “1 suitcase”

Normalize all time windows into:
- local timezone `Asia/Singapore`
- 30-minute buckets for matching
- effective “this week only” instances derived from the recurring template

### Route Similarity Model
Fixed origin:
- `NUS Utown`

Confidential matcher computes:
- road route from Utown to destination using an offline Singapore road graph packaged with the confidential service
- route corridor cells using `H3`
- destination cluster and route signature
- pairwise similarity score based on route overlap and detour cost

Recommended scoring:
- `score = 0.55 * route_overlap + 0.30 * destination_proximity + 0.15 * time_overlap`
- hard reject if:
  - gender preference incompatible
  - pax constraints incompatible
  - time overlap under 60 minutes
  - estimated detour exceeds configured threshold, initially `12 minutes`

### Group Formation Rules
Eligible riders are grouped when either:
- there are `4` compatible riders, or
- it is `5 hours` before the start of the availability window and there are at least `2` compatible riders

Group size priority:
1. size `4`
2. size `3`
3. size `2`

Selection algorithm:
- among eligible candidates in the same window, choose the group with highest average pairwise score
- if tied, prefer:
  1. greater minimum pairwise score
  2. lower max detour
  3. earlier submission time

### Anonymous Pre-Confirm Stage
Before reveal, each rider sees only:
- pickup point `NUS Utown`
- pickup window
- group size
- estimated detour band
- estimated fare band
- designated booker pseudonym label such as `Rider C`
- confirmation deadline

They do **not** see:
- names
- emails
- phone numbers
- exact addresses
- map pins of other riders

### Acknowledgement Rules
- Each rider has `30 minutes` to acknowledge after notification
- If any rider declines or times out:
  - dissolve the tentative group
  - return remaining riders to pool if still eligible
  - retry matching
- After unanimous acknowledgement:
  - confidential matcher re-encrypts each rider’s exact address to the other riders’ `X25519` public keys
  - backend relays ciphertext envelopes
  - clients decrypt locally and show addresses to all confirmed riders

## Booker Assignment

### Booker Eligibility
A rider is eligible to be the booker only if:
- no unpaid overdue debt
- not currently suspended
- acknowledged within deadline
- reliability score above minimum threshold, initially `0.70`

### Booker Selection
Choose the booker by ordered criteria:
1. fewest prior booker assignments in last 30 days
2. highest reliability score
3. earliest acknowledgement timestamp
4. deterministic tie-breaker on `rider_id`

### Reliability Score Inputs
Initial score starts at `1.0` and decays for:
- missed acknowledgement
- post-confirm cancellation
- unpaid debt
- disputed payment confirmed against rider

Reliability score improves for:
- successful completed rides
- timely payment confirmations
- successful booker completion

## Trip Lifecycle

### 1. Registration
1. User enters university email
2. Backend validates allowlisted domain
3. OTP sent to email
4. User verifies OTP
5. App generates device keypairs
6. Backend stores public keys and issues session
7. User sets optional self-declared gender and match preferences

### 2. Availability Submission
1. User enters/stores exact home address locally
2. User selects this week’s time window
3. User selects party size and optional same-gender constraint
4. Device sends destination only to confidential matcher
5. Confidential matcher returns:
   - `sealed_destination_ref`
   - `route_descriptor_ref`
   - `estimated_fare_band`
6. Standard backend stores only pseudonymous availability metadata plus opaque refs

### 3. Matching
1. Match worker scans windows continuously
2. If 4 compatible riders exist, create tentative group immediately
3. Otherwise at `T-5h`, create best available group of size `2–4`
4. Push notifications sent to all candidate riders

### 4. Confirmation and Reveal
1. Riders acknowledge or decline
2. On unanimous acknowledgement, backend requests address share envelopes
3. Confidential matcher re-encrypts each address to every confirmed rider device
4. Clients decrypt and display addresses locally
5. Booker is assigned and notified

### 5. Booking
1. Booker books external ride service
2. Booker uploads booking proof and ETA screenshot
3. Group receives trip summary and final pickup plan

### 6. Completion and Cost Split
1. Booker marks trip completed
2. Booker uploads fare receipt and final total
3. Backend splits cost equally among all confirmed riders
4. Debt records created for non-booker riders
5. Riders mark debt as paid
6. Booker confirms receipt or rider opens dispute

### 7. Enforcement
- `+6h`: reminder
- `+24h`: overdue warning
- `+72h`: temporary suspension until resolution
- `+7d`: admin review for possible longer suspension
- disputes pause automated escalation until resolved

## Public APIs / Interfaces / Types

### Auth API
- `POST /auth/request-otp`
  - input: `{ email }`
  - output: `{ otp_request_id, expires_at }`
- `POST /auth/verify-otp`
  - input: `{ otp_request_id, code, device_public_keys }`
  - output: `{ access_token, refresh_token, rider_profile }`
- `POST /auth/logout-device`
  - revokes device session and marks device keys inactive

### Profile API
- `GET /me`
- `PATCH /me/preferences`
  - input:
    - `self_declared_gender`
    - `same_gender_only`
    - `min_group_size`
    - `max_group_size`
    - `note`

### Availability API
- `POST /availability`
  - input:
    - `window_start`
    - `window_end`
    - `min_group_size`
    - `max_group_size`
    - `same_gender_only`
    - `self_declared_gender`
    - `sealed_destination_ref`
    - `route_descriptor_ref`
  - output: `{ availability_id, estimated_fare_band }`
- `GET /availability`
- `DELETE /availability/:id`

### Matching API
- `GET /groups/current`
- `POST /groups/:group_id/acknowledge`
  - input: `{ accepted, device_signature }`
- `GET /groups/:group_id/reveal-status`
- `GET /groups/:group_id/address-envelopes`
  - returns encrypted address shares only after unanimous acknowledgement

### Trip API
- `POST /trips/:trip_id/booking-proof`
- `POST /trips/:trip_id/complete`
  - input: `{ final_cost, receipt_upload_ref }`
- `GET /trips/:trip_id`
- `POST /trips/:trip_id/cancel`

### Debt API
- `GET /debts`
- `POST /debts/:debt_id/mark-paid`
- `POST /debts/:debt_id/confirm-received`
- `POST /debts/:debt_id/dispute`

### Admin API
- `GET /admin/disputes`
- `POST /admin/disputes/:id/resolve`
- `POST /admin/riders/:rider_id/suspend`
- `POST /admin/riders/:rider_id/reinstate`

### Core Types
- `UserIdentity`
- `RiderProfile`
- `DeviceKey`
- `AvailabilityWindow`
- `MatchPreference`
- `SealedDestinationRef`
- `RouteDescriptorRef`
- `TentativeGroup`
- `GroupAcknowledgement`
- `AddressShareEnvelope`
- `TripRecord`
- `DebtRecord`
- `DisputeRecord`
- `ModerationAction`

## Data Model

### Identity Domain
- `users`
  - `user_id`
  - `email`
  - `email_domain`
  - `email_verified_at`
  - `status`
- `devices`
  - `device_id`
  - `user_id`
  - `x25519_public_key`
  - `ed25519_public_key`
  - `last_seen_at`
  - `revoked_at`

### Rideshare Domain
- `riders`
  - `rider_id`
  - `user_id` (service-layer access only)
  - `reliability_score`
  - `suspension_status`
- `preferences`
- `availability_entries`
  - `availability_id`
  - `rider_id`
  - `window_start`
  - `window_end`
  - `same_gender_only`
  - `self_declared_gender`
  - `min_group_size`
  - `max_group_size`
  - `sealed_destination_ref`
  - `route_descriptor_ref`
- `tentative_groups`
- `group_members`
- `trips`
- `trip_members`
- `debts`
- `disputes`
- `audit_events`

### Confidential Store
Outside normal DB, the confidential matcher manages:
- sealed destination blobs
- sealed route descriptors
- reveal authorization state

Plaintext addresses must never be queryable from the standard DB.

## Edge Cases and Failure Rules

### Duplicate or Conflicting Availability
- User may only have one active availability per overlapping window
- New overlapping submission replaces old one after explicit confirmation

### Device Loss
- Lost device revokes its keys
- If user loses device after acknowledging but before reveal, user must re-login on new device and re-acknowledge if reveal has not occurred

### Cancellation Rules
- Before group formation: free cancel
- After tentative group but before unanimous acknowledgement: no penalty, group dissolves/re-matches
- After unanimous acknowledgement but before booking: reliability penalty
- After booker uploads booking proof: rider owes share unless admin marks emergency exception

### No-Show / Non-Response
- acknowledgement timeout counts as soft reliability penalty
- repeated timeouts trigger temporary matching cooldown

### Disputes
- riders can dispute:
  - wrong fare amount
  - payment already sent
  - cancellation exception
- while disputed:
  - debt marked `under_review`
  - enforcement timers paused

### Safety / Abuse
- users can report rider behavior after trip
- report count feeds admin review, not automatic ban in v1

## Testing and Acceptance Criteria

### Unit Tests
- email domain allowlist validation
- OTP expiry and rate limiting
- reliability score updates
- booker selection ordering
- debt reminder and suspension timeline
- equal split calculation and rounding rules

### Confidential Matcher Tests
- exact address never appears in returned standard-backend payloads
- route similarity scoring is deterministic for same inputs
- no plaintext destination written to logs
- address envelopes decrypt only with intended device key
- reveal blocked until every member acknowledged

### Integration Tests
- OTP signup to active session
- availability submission with opaque destination refs
- group auto-formation at size 4
- group formation at `T-5h` with size 2–3
- decline/timeout causes regroup
- unanimous acknowledgement triggers reveal envelopes
- booker assignment excludes overdue/suspended riders
- trip completion creates correct debt records
- dispute pauses enforcement
- overdue debt causes temporary suspension after 72h

### End-to-End Scenarios
1. `4` riders, same Friday window, compatible routes, all accept, reveal succeeds, trip completes, all pay
2. `3` riders, no fourth rider, match forms at `T-5h`
3. one rider declines, remaining riders are rematched
4. one rider has same-gender-only enabled and incompatible candidates are excluded
5. booker uploads receipt, one rider disputes, suspension does not occur during review
6. overdue debt triggers temporary suspension, resolved debt restores access

### Security Acceptance Criteria
- standard backend DB dump does not contain recoverable addresses
- admin UI never renders address fields
- audit logs contain redacted payloads only
- only unanimous-ack groups receive decryptable address shares
- revoked device keys cannot decrypt future reveals

## Delivery Phases

### Phase 1: Foundation
- create monorepo with `apps/mobile`, `apps/api`, `apps/admin`, `services/confidential-matcher`
- establish auth, DB schemas, push notification plumbing, secure device key registration

### Phase 2: Privacy Core
- implement confidential matcher interface
- implement sealed destination submission and opaque refs
- implement availability entry and time-window normalization

### Phase 3: Matching
- implement worker for tentative group formation
- implement anonymous group notifications and 30-minute acknowledgement deadline
- implement automatic rematching on decline/timeout

### Phase 4: Reveal and Trip Flow
- implement address-share envelopes after unanimous acknowledgement
- implement booker assignment and booking-proof upload
- implement trip completion and equal split ledger

### Phase 5: Enforcement and Admin
- implement reminders, disputes, suspension rules, and admin review console
- add audit trails and privacy-focused observability

## Explicit Assumptions
- “Server should not know addresses” is interpreted as: the standard API, database, admins, logs, analytics, and normal operators cannot access plaintext addresses; a confidential matching component may process them transiently in protected memory only
- Equal split is acceptable for v1; route-distance-weighted cost allocation is deferred
- Same-gender preference is based on self-declared data only
- University verification is email-domain based only in v1
- One campus and one pickup origin are sufficient for first launch
- External ride booking remains manual through existing ride-hailing apps
- The app will document that third-party mobile geocoding providers may receive address queries unless a later offline geocoding/routing project is added
