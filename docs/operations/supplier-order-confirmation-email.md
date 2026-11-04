# Supplier Order Confirmation Email

Purpose: manual customer email for Sales-Vergabe `AB senden`. The Ops app generates the plain order-confirmation PDF with the original NEONTRIP logo from the accepted order and current BillingCase, reserves the side effect with an idempotency key, then calls n8n. n8n only validates and sends through Outlook.

## Workflow

Import:

`workflows/supplier-order-confirmation-email-v0.1.inactive-draft.json`

Structure:

1. `Order Confirmation Webhook`
2. `Validate + Build Email`
3. `Payload Valid?`
4. `Send via Outlook`
5. `Respond Success` or `Respond Invalid`

Use a Webhook trigger, not an Outlook Email Trigger. Outlook Email Trigger reacts to inbound mailbox events; this workflow must send only after an explicit operator click in Sales-Vergabe.

## n8n Setup

1. Import the workflow JSON into n8n.
2. Open `Send via Outlook`.
3. Select the Microsoft Outlook OAuth credential for Fabienne or the NEONTRIP mailbox.
4. Execute the webhook once in test mode with a safe test payload if needed.
5. Activate the workflow.
6. Copy the production webhook URL for path `supplier-order-confirmation`.

## Coolify

Set this runtime environment variable on the Ops app:

```text
SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL=https://<n8n-host>/webhook/supplier-order-confirmation
```

Then restart/redeploy the Ops app.

No secrets belong in Git. The Outlook credential stays in n8n. The Coolify value is only the webhook URL.

## Expected Payload

The Ops app sends:

```json
{
  "kind": "supplier_order_confirmation",
  "saleId": "sale-id",
  "recipientEmail": "kunde@example.com",
  "subject": "Auftragsbestätigung A-N-123",
  "html": "<p>...</p>",
  "text": "Plain text fallback",
  "signature": "fabienne_neontrip",
  "requestedBy": "Fabienne",
  "idempotencyKey": "supplier-sale:...",
  "attachment": {
    "filename": "auftragsbestaetigung-A-N-123.pdf",
    "contentType": "application/pdf",
    "contentBase64": "...",
    "sha256": "..."
  }
}
```

The workflow returns:

```json
{
  "ok": true,
  "status": "sent",
  "messageId": "..."
}
```

## QA

1. In Sales-Vergabe, click `AB senden` on a real sale.
2. Confirm the dialog.
3. Expected UI message: `Auftragsbestaetigung wurde an ... gesendet.`
4. Confirm the customer received one email with one PDF attachment.
5. A newly confirmed button click intentionally sends the AB again. Reusing the same request idempotency key does not resend. The old cover-page AB renderer is removed.

## Rollback

Remove or blank this Coolify variable and restart the Ops app:

```text
SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL
```

The button remains visible, but sends nothing and reports that the webhook is not configured.

## Proforma attachment (2026-11-04)

The active customer delivery worker `wqaTsVKuKqKnp2AG` adds this same PDF to unsent `ORDER_CONFIRMATION_PROFORMA` and `PROFORMA_UPDATE` documents through Easybill attachments. The internal worker-authenticated `/api/internal/billing/order-confirmation` endpoint only renders; it never sends. Both manual and automatic paths use the current BillingCase, falling back to the accepted sale where no BillingCase exists. Only the selected delivery is shown, followed by the approved production/payment timing note at the end.

Existing Easybill `last_postbox_id` still prevents resending. An AB already linked to the same document is reused only after exact filename, document ownership and byte-for-byte PDF comparison; stale content blocks sending for manual removal of the old AB in Easybill; a new upload must have its document linkage confirmed before email. Failures go through the existing leased job retry/block path and error workflow `M4uG1HAtN9Zggxww` to `support@neontrip.de`. The manual Outlook workflow `p4lm3w9jPHnaP4VX` uses that error workflow too. The hyphenated domain remains unverified and is not used.

The existing single-PDF recipient `erechnung@duesseldorf.de` is held for manual combined-document handling instead of sending two PDFs to a mailbox that rejects them. Previously sent documents are not replayed. No customer test email is part of release verification.

Localized n8n rollback uses version history for the customer delivery worker; code rollback reverts this change through the normal release gate. Deploy the renderer endpoint before updating the delivery worker. Source patch: `workflows/billing-v2/order-confirmation-delivery.mjs`.
