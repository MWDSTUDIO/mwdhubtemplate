# Email authentication — the three DNS records for `madamewedding.design`

**The prerequisite that counts more than all the rest** (notifications
brief §2 bis): before a single reminder email leaves, the domain must be
protected against impersonation. This is DNS work, not code — Claude
prepares the exact values, **Estelle poses them in Cloudflare**. Same
discipline as the migrations.

All three records go in Cloudflare → `madamewedding.design` → DNS →
Records. Proxy status does not apply to TXT records.

---

## 1. SPF — verify, and pose if absent

Authorises Google to send for the domain. Check first: Cloudflare may
already carry it (the domain's MX already points to Google).

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `@` |
| Content | `v=spf1 include:_spf.google.com ~all` |

⚠️ A domain may carry **only one** SPF record. If a `TXT` starting with
`v=spf1` already exists, do not add a second — make sure it contains
`include:_spf.google.com` and leave it as is.

## 2. DKIM — activate in Google Admin, then pose the key

The signature proves the message truly left Google's servers unaltered.

1. In **admin.google.com** → Apps → Google Workspace → Gmail →
   **Authenticate email** : select `madamewedding.design`, click
   **Generate new record** (keep the default 2048-bit, selector `google`).
2. Google shows a TXT record. Pose it in Cloudflare:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `google._domainkey` |
| Content | *(the `v=DKIM1; k=rsa; p=…` value Google displays — it is unique to the domain, only the Admin console can produce it)* |

3. Back in the Admin console, click **Start authentication**.
   (Allow up to 48 h for DNS to settle before this step succeeds.)

## 3. DMARC — observe first, never straight to reject

Tells receiving mailboxes what to do with mail that fails SPF/DKIM —
this is the principal protection against the fraud scenario of the
banking brief: a plausible email "from the house" announcing new
coordinates.

**Step 1 — now (observation, `p=none`):**

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:hello@madamewedding.design; fo=1; adkim=s; aspf=s` |

Aggregate reports arrive at `hello@` (XML attachments, roughly daily,
from Google/Microsoft/etc.). Nothing is blocked yet — this is the watch.

**Step 2 — after 2–3 weeks of clean reports** (every legitimate source
aligned), change the Content to:

```
v=DMARC1; p=quarantine; rua=mailto:hello@madamewedding.design; fo=1; adkim=s; aspf=s
```

**Step 3 — after 2–3 further weeks without incident:**

```
v=DMARC1; p=reject; rua=mailto:hello@madamewedding.design; fo=1; adkim=s; aspf=s
```

⚠️ **Never pass directly to `reject`** : if SPF or DKIM is misaligned,
the house's own legitimate mail — client correspondence included —
would be refused. The observation window is the point.

---

## Order and gate

1. SPF verified · 2. DKIM activated · 3. DMARC posed in `p=none`.
Reminder **emails stay held until this is done** (and until the Gmail
OAuth credentials and the launch word exist — see below). The in-app
channel works regardless.

## The environment variables the sending box needs

All secrets live **outside the repository**, as environment variables
(Netlify → Site configuration → Environment variables, and `.env.local`
for local work):

| Variable | What it is |
|---|---|
| `GMAIL_CLIENT_ID` | OAuth client (Google Cloud console → APIs → Credentials) |
| `GMAIL_CLIENT_SECRET` | its secret |
| `GMAIL_REFRESH_TOKEN` | refresh token for `hello@…`, scope `gmail.send` only |
| `GMAIL_SENDER` | `hello@madamewedding.design` |
| `REMINDER_SENDER_NAME` | fallback display name (per-wedding value wins) |
| `REMINDER_REPLY_TO` | fallback Reply-To (per-wedding value wins) |
| `REMINDERS_SECRET` | shared secret between the scheduler and `/api/reminders/tick` |
| `REMINDERS_ENABLED` | `1` = the scheduler wakes. **This is the launch authorization.** |
