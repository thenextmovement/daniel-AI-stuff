# Supplier Sales Integrations

Purpose: production setup for the Sales-Vergabe diagnostics `Supplier-Trello`, `Zahlungserinnerungen` and the internal Shopify-link watchdog.

Supabase remains the source of truth. Trello is only a projection after a supplier assignment. Payment reminder emails are only sent after the Ops app has reserved the reminder in `supplier_payment_reminders`.

## Shopify Supplier Tag Sync

The Sales-Vergabe app can regularly reconcile active, not-yet-assigned rows against Shopify Admin tags and cancellation state. This catches orders that were tagged or cancelled in Shopify outside the Ops UI, especially:

```text
Quentin (noch bezahlen)
```

Import this inactive n8n draft:

```text
workflows/supplier-shopify-tag-sync-v0.1.inactive-draft.json
```

Structure:

1. `Every 5 Minutes`
2. `Config`
3. `Config Preflight`
4. `Ops: Sync Shopify Supplier Tags`

The workflow calls:

```http
POST https://ops.neontrip.de/api/ops/supplier-sales
Authorization: Bearer <internal-token>
Content-Type: application/json

{
  "action": "sync_shopify_supplier_tags",
  "limit": 50,
  "operatorName": "n8n Supplier Shopify Tag Sync"
}
```

Use one of these n8n environment variables for the bearer token. It must match one of the Ops app runtime tokens.
Prefer the dedicated Ops internal key first so the sync uses the same auth path as other internal Ops automations:

```text
OPS_INTERNAL_API_KEY
QUOTE_INTERNAL_API_TOKEN
SUPPLIER_SALES_AGENT_API_TOKEN
NEONTRIP_OFFERS_INTERNAL_API_KEY
```

The Ops app keeps the batch bounded to max. 100 active rows. Replays are safe: existing Shopify tags update the Supabase row to assigned, Shopify `cancelledAt` updates it to `canceled`, and rows already outside the active states are skipped by the active-row query.

## Completed Offers Shopify-Link Watchdog

The existing workflow `NEONTRIP Supplier Completed Offers Sync v0.1` checks the response of `action=sync_completed_offers` after every ten-minute run. The Ops response contains `watchdogAlerts` only when a newly linked, previously unlinked Offer row has all three strict contradiction signals:

1. the Shopify order was created more than one hour before the Offer acceptance;
2. the Offer and Shopify customer emails are both present and different;
3. the Offer and Shopify gross totals are both present and differ by at least 0.05 EUR.

The alert contains no customer names, email addresses, phone numbers or addresses. It includes only Offer/Shopify identifiers, both timestamps, both totals and a link to the filtered Sales-Vergabe. The workflow sends the internal mail from the existing Outlook credential `Microsoft Outlook support@neontrip.de` to `info@neontrip.de`.

This is fail-closed behavior. The contradictory Shopify candidate is not merged into the Sale. Ops stores a PII-free guard fingerprint in Sale metadata and emits the alert only when that candidate is first blocked; later scheduled runs keep blocking the same candidate without sending the same alert again. The guard does not assign, tag, project or otherwise mutate Shopify or Trello. A later valid Shopify link clears the stale guard marker during the normal merge.

Repository artifact:

```text
workflows/supplier-completed-offers-sync-v0.1.inactive-draft.json
```

The imported production workflow must be updated in place. Do not create a parallel scheduled copy.

## Supplier Trello

Set these runtime variables in Coolify:

```text
TRELLO_API_KEY=<secret>
TRELLO_TOKEN=<secret>
SUPPLIER_TRELLO_QUENTIN_LIST_ID=6347e0971a7efc0482e6c3fe
SUPPLIER_TRELLO_SAID_LIST_ID=675bfd705bc9a7e79be096df
SUPPLIER_TRELLO_SPECIAL_LIST_ID=63ea2fff9a56f75ebfeac4d7
SUPPLIER_ASSIGNMENT_TASKS_ENABLED=false
```

List mapping:

```text
Quentin: Quentin Neon Signs / Sign Approved (NEON TRIP) normal
Said: Anfrage Management Neontrip / SAEID (selber machen)
Special: Quentin Special Order / Signs
```

`TRELLO_API_KEY` and `TRELLO_TOKEN` are secrets. Do not commit them and do not paste them into logs.

## Payment Reminder Email

Import this inactive n8n draft:

```text
workflows/supplier-payment-reminder-email-v0.1.inactive-draft.json
```

Structure:

1. `Payment Reminder Webhook`
2. `Validate + Build Email`
3. `Payload Valid?`
4. `Send via Outlook`
5. `Respond Success` or `Respond Invalid`

Use a Webhook trigger, not an Outlook Email Trigger. This email must only go out after an explicit Sales-Vergabe action.

## n8n Setup

1. Import the workflow JSON into n8n.
2. Open `Send via Outlook`.
3. Select the Microsoft Outlook OAuth credential for Fabienne or the NEONTRIP mailbox.
4. Execute the webhook once in test mode with a safe test payload.
5. Activate the workflow.
6. Copy the production webhook URL for path `supplier-payment-reminder`.

## Coolify

Set this runtime variable on the Ops app:

```text
SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL=https://<n8n-host>/webhook/supplier-payment-reminder
```

Then restart/redeploy the Ops app.

## Expected Payload

The Ops app sends:

```json
{
  "sale": {
    "id": "sale-id",
    "customerName": "Max Beispiel",
    "customerCompany": "Beispiel GmbH",
    "shopifyOrderName": "#1234",
    "offerNumber": "A-N-123"
  },
  "recipientEmail": "kunde@example.com",
  "paymentLink": "https://...",
  "message": "Optionaler Text aus der Sales-Vergabe",
  "reminderKey": "supplier-sale:..."
}
```

The workflow rejects invalid payloads and missing payment links.

## QA

1. Restart the Ops app after setting the variables.
2. Open `/ops/sales-vergabe`.
3. Expected diagnostics: `Supplier-Trello` is ok and `Zahlungserinnerungen` is ok.
4. Assign one safe test sale to Quentin. Expected: a Trello card appears in the configured Quentin list.
5. Trigger one payment reminder on a safe test sale with a real payment link. Expected: one Outlook email is sent and `supplier_payment_reminders.status` becomes `sent`.
6. Trigger the same reminder again with the same idempotency key. Expected: no duplicate email.
7. Manually execute the Shopify Supplier Tag Sync workflow once. Expected: HTTP 200 with `shopifySupplierTagSync.status` as `synced` or `skipped`. If an active Shopify order already has `Quentin (noch bezahlen)` or has been cancelled, it should disappear from the active Sales-Vergabe view after reload.
8. Validate the Completed Offers workflow with a non-sending pinned response containing no `watchdogAlerts`. Expected: the email branch receives zero items.
9. Validate the strict positive fixture locally. Expected: exactly one privacy-safe alert object; replay after the row is linked produces no alert. Do not use a real customer Sale as a mail canary.

## Rollback

To disable Trello projection, remove or blank:

```text
SUPPLIER_TRELLO_QUENTIN_LIST_ID
SUPPLIER_TRELLO_SAID_LIST_ID
SUPPLIER_TRELLO_SPECIAL_LIST_ID
```

To disable payment reminder emails, remove or blank:

```text
SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL
```

To disable regular Shopify supplier tag reconciliation, deactivate the n8n workflow `NEONTRIP Supplier Shopify Tag Sync v0.1`.

Restart the Ops app after rollback. Without the reminder webhook, the app falls back to internal tasks.
