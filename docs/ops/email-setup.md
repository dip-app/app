# Email setup: your steps

Postmark sends, Squarespace Domains holds DNS and forwarding. About 20 minutes plus DNS wait. The long engineering reference is [email-runbook.md](email-runbook.md); you do not need it.

Squarespace already created the **Email Security** preset (SPF `v=spf1 -all`, DMARC `p=reject`, an empty `_domainkey` TXT). Leave SPF and the empty `_domainkey` record alone: Postmark's bounce domain handles SPF, and its DKIM key lives at a different name (`<selector>._domainkey`). Only the DMARC policy needs one edit (step 4).

## 1. Forwards in Squarespace (domain panel, email forwarding)
Forward to your own inbox:
- `support@letsdip.work`
- `notify@letsdip.work` (the From address; replies go to support@ anyway)
- `dmarc@letsdip.work`

Test: send a message from a personal account to `support@letsdip.work`.

## 2. Postmark
1. Create the account. Create a server named `DIP`, with a **Transactional** message stream named `notifications`.
2. Sender Signatures, then Domains, then add `letsdip.work`. Postmark shows two records to copy: a DKIM TXT (`<selector>._domainkey`) and a Return-Path CNAME (`pm-bounces`, value `pm.mtasv.net`). Keep the page open.
3. In the server, copy the **Server API token** (Settings, API Tokens).

## 3. DNS records in Squarespace (DNS Settings, custom records)
Add exactly what Postmark shows:

| Type | Host | Data |
| --- | --- | --- |
| TXT | `<selector>._domainkey` (from Postmark) | the `k=rsa; p=...` value |
| CNAME | `pm-bounces` | `pm.mtasv.net` |

Squarespace may append `.letsdip.work` to the host automatically: enter only the part before it.

## 4. Edit the existing `_dmarc` TXT
Change its value to (reports go to the forward from step 1):

```
v=DMARC1; p=none; rua=mailto:dmarc@letsdip.work; fo=1
```

After two to four weeks of clean reports, set `p=quarantine`, later `p=reject` again.

## 5. Verify and activate
1. In Postmark, click Verify on DKIM and Return-Path. Wait until both are green (minutes to a few hours).
2. Request account approval in Postmark (new accounts are in test mode until approved; say: transactional event notifications to employees who opted in).
3. Store the token: in a clone of `dip-app/secrets` run `scripts/add-secret.sh POSTMARK_SERVER_TOKEN` and paste the Server API token.
4. In Postmark, Webhooks for the `notifications` stream: I will give you the URL and password at deploy time.

Then tell me. I deploy, switch the provider on for a pilot company and send a test to you.
