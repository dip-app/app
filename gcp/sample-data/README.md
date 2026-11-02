# Local V1 sample data

`v1.json` contains only synthetic data. It gives contributors a shared company, member, organizer, social tag, event, and one RSVP while feature implementations are developed. It does not implement or bypass a future callable workflow in the app.

The reference date is **October 28, 2026**. The event is fixed at **November 2, 2026, 23:00 UTC** (6 PM in New York/Pittsburgh) and ends an hour later. Dates remain fixed so tests are reproducible; they will eventually become past dates. Use a fixed clock in tests or deliberately revise this fixture when upcoming-event development needs a later date.

| Item | Value |
| --- | --- |
| Emulator project | `demo-dip` |
| Company | `company-demo` |
| Member | `member-demo` / `member@example.invalid` (Google provider, synthetic `sub` `google-member-demo`) |
| Organizer | `admin-demo` / `admin@example.invalid` (Google provider, synthetic `sub` `google-admin-demo`) |
| Company domain | `example.invalid` -> `company-demo` |
| Event | `event-demo`, capacity 20, attendee count 1 |

These are public fixtures for local emulators only. The reserved `.invalid` domain cannot deliver email. Accounts are Google-provider users (ADR 0007); there are no passwords. On the Auth emulator, sign in as one with a synthetic Google credential whose ID token is unsigned JSON, e.g. `{"sub":"google-member-demo","email":"member@example.invalid","email_verified":true,"name":"Demo Member"}`. Image URL fields are intentionally empty; image selection and fallback behavior belong to the V1 app implementation. No external API or asset downloads are required to seed.

The company document has no secret fields. Membership comes from the private `companyDomains/example.invalid` record (`{ "companyId": "company-demo" }`), which `resolveMembershipV1` reads after reducing a verified Google email to its root domain. The seed refuses keys that are not root domains or that are personal email providers.

## Seed running emulators

Start the Auth and Firestore emulators from the repository root, leaving that terminal running:

```sh
npx firebase emulators:start --project demo-dip --only auth,firestore
```

In another terminal at the repository root, after `npm ci`:

```sh
GCLOUD_PROJECT=demo-dip \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
node gcp/scripts/seed.mjs
```

The script refuses to run unless the project and both emulator addresses exactly match those values. It initializes the Admin SDK only after the checks pass, and never falls back to cloud services. ISO date fields are converted recursively into Firestore `Timestamp` values; JSON fixtures themselves retain readable UTC strings.

Re-running updates the same reserved Auth user IDs and replaces only the seven listed Firestore documents. It does not clear collections, delete users, or touch unrelated emulator records. Re-running does restore seeded roles, profiles, RSVPs, and event counts, so do it intentionally if you have edited those reserved records. Auth and Firestore writes are not one cross-service transaction; rerun after a partial interruption.

For a temporary smoke check that starts and stops its own emulators:

```sh
npx firebase emulators:exec --project demo-dip --only auth,firestore "node gcp/scripts/seed.mjs"
```

Emulator data is discarded when those processes stop unless you explicitly manage local emulator import/export. Keep real user data out of exports.

The setup branch's deny-all client rules still apply after seeding. Use emulator administrative tools to inspect fixtures until feature PRs introduce reviewed client access rules. No endpoint, production project, or live account is created by this seed.
