# Operations

Runbooks for people who deploy and operate DIP. Agents prepare these changes; a human runs the deploys.

| Page | What it covers |
| --- | --- |
| [Deploy runbook](deploy-runbook.md) | Tooling versions, per-surface deploy commands, admin live environment, one-time project setup, custom domain, caching, rollback, smoke tests, the combined-branch flow |
| [Launch switches](launch-switches.md) | The noindex switch (`scripts/set-indexing.sh`), App Store ID and official badge wiring |
| [TestFlight and Universal Links](testflight-universal-links.md) | Team ID, entitlements, build upload, TestFlight and App Store Connect steps |
| [Secrets and signing](secrets.md) | The encrypted `dip-app/secrets` repo (sops + age): layout, pull and GCP sync scripts, rotation, onboarding, owner steps, threat model |
| [Seed and backfill conventions](seed-data.md) | Dry-run default, `seed-` IDs, manifests and undo for data scripts |
| [Email setup](email-setup.md) | Mailboxes, Postmark, SPF, DKIM, DMARC, secrets, params, webhook, pilot enablement and verification for notification emails |
| [Email compatibility](email-compatibility.md) | `npm run check:email` (Gmail, Outlook, Apple Mail checks run in CI), known client limits, manual pre-launch checklist |
| [AI event ideas](ai-events.md) | Anthropic key secret, budget values, TTL policies, pilot, kill switches |
| [Push enablement](../design/push-client.md) | APNs key, entitlement, flag, device test plan |
