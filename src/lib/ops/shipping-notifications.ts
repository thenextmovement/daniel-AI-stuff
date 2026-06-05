import { isValidEmail, normalizeEmail } from "@/lib/quotes/customer";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type ShippingNotificationKind = "customer_pickup_available" | "internal_delivery_problem";
export type ShippingNotificationStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type ClaimedShippingNotificationRow = {
  notification_id: string;
  notification_key: string;
  kind: ShippingNotificationKind;
  recipient_type: "customer" | "internal";
  recipient_email: string;
  attempts: number;
  shipment_id: string;
  incident_id: string | null;
  shipment_key: string;
  shopify_order_number: string | null;
  request_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  carrier: string;
  tracking_number: string | null;
  tracking_url: string | null;
  status: string;
  incident_type: string | null;
  incident_title: string | null;
  incident_description: string | null;
  incident_severity: string | null;
  latest_event_time: string | null;
  latest_event_location: string | null;
  latest_event_status_text: string | null;
};

type ShippingNotificationRow = {
  id: string;
  notification_key: string;
  kind: ShippingNotificationKind;
  recipient_email: string;
  status: ShippingNotificationStatus;
  attempts: number;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type ShippingPreparedNotification = {
  notificationId: string;
  notificationKey: string;
  kind: ShippingNotificationKind;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  attempts: number;
};

const INTERNAL_SHIPPING_ALERT_EMAIL = "info@neontrip.de";

function trimNullable(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraph(value: string) {
  return `<p>${value}</p>`;
}

function trackingLink(url: string | null, label = "Sendungsverfolgung oeffnen") {
  if (!url) return "";
  return `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
}

const FABIENNE_SIGNATURE_HTML = `
<br><br>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family: Arial, Helvetica, sans-serif; color:#111111;">
  <tbody>
    <tr>
      <td style="padding:0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">
          <tbody>
            <tr>
              <td style="padding:16px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tbody>
                    <tr>
                      <td valign="top" style="width:140px; padding-right:16px;">
                        <img src="https://cdn.shopify.com/s/files/1/0534/7819/5350/files/fabienne123.jpg?v=1764000653" alt="Fabienne Trapp" width="120" height="120" style="display:block; width:120px; height:120px; border-radius:60px; border:2px solid #111111; object-fit:cover;">
                      </td>
                      <td valign="top" style="padding-top:2px;">
                        <div style="font-size:16px; font-weight:700; color:#111111; margin:0 0 4px 0;">Fabienne Trapp</div>
                        <div style="font-size:12px; color:#6b7280; margin:0 0 10px 0;">Beratung &amp; Realisierung</div>
                        <div style="font-size:13px; font-weight:700; color:#111111; margin:0 0 8px 0;">NEONTRIP&reg;</div>
                        <div style="font-size:13px; line-height:1.6; color:#111111;">
                          Tel: <a href="tel:+4921154257240" style="color:#111111; text-decoration:none;">+49 211 54257240</a><br>
                          E-Mail: <a href="mailto:support@neontrip.de" style="color:#111111; text-decoration:none;">support@neontrip.de</a><br>
                          Web: <a href="https://www.neontrip.de" style="color:#111111; text-decoration:none;">www.neontrip.de</a><br>
                          Adresse: Bilker Allee 29, 40219 D&uuml;sseldorf
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#121212; border-radius:10px;">
                  <tbody>
                    <tr>
                      <td align="center" style="padding:18px 16px;">
                        <img src="https://cdn.shopify.com/s/files/1/0534/7819/5350/files/weiss_logo_NEONTRIP.png?v=1764003450" alt="NEONTRIP" width="420" style="display:block; width:100%; max-width:420px; height:auto; border:0; outline:none; text-decoration:none;">
                        <div style="margin-top:8px; font-size:11px; font-weight:700; letter-spacing:0.6px; color:#ffffff;">UNIQUE LIGHTING AND BRANDING</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>`.trim();

function firstName(name: string | null) {
  const first = trimNullable(name)?.split(/\s+/)[0] || null;
  if (!first || first.length < 2) return null;
  return first;
}

function greeting(row: Pick<ClaimedShippingNotificationRow, "customer_name">) {
  const name = firstName(row.customer_name);
  return name ? `Guten Tag ${escapeHtml(name)},` : "Guten Tag,";
}

function isPickupReminder(row: Pick<ClaimedShippingNotificationRow, "notification_key">) {
  return row.notification_key.includes(":reminder:");
}

function assertValidCustomerRecipient(email: string | null) {
  const normalized = normalizeEmail(email || "");
  if (!normalized || !isValidEmail(normalized)) {
    throw new QuoteValidationError("Shipping-Kundenmail braucht eine gueltige Kunden-E-Mail.", [], 422);
  }
  const domain = normalized.split("@").pop() || "";
  if (domain === "neontrip.de" || normalized.endsWith("@neontrip.test")) {
    throw new QuoteValidationError("Shipping-Kundenmail darf nicht an interne oder Test-Adressen gesendet werden.", [], 422);
  }
  return normalized;
}

function assertInternalRecipient(email: string | null) {
  const normalized = normalizeEmail(email || INTERNAL_SHIPPING_ALERT_EMAIL);
  if (!normalized || !isValidEmail(normalized)) {
    throw new QuoteValidationError("Interne Shipping-Warnung braucht eine gueltige Empfaengeradresse.", [], 422);
  }
  return normalized;
}

export function buildPickupAvailableCustomerEmail(row: ClaimedShippingNotificationRow) {
  const recipientEmail = assertValidCustomerRecipient(row.recipient_email || row.customer_email);
  const carrier = trimNullable(row.carrier)?.toUpperCase() || "Versanddienstleister";
  const trackingNumber = trimNullable(row.tracking_number);
  const location = trimNullable(row.latest_event_location);
  const statusText = trimNullable(row.latest_event_status_text);
  const orderLabel = trimNullable(row.shopify_order_number);
  const reminder = isPickupReminder(row);
  const subjectPrefix = reminder ? "Erinnerung: Ihr NEONTRIP Paket liegt zur Abholung bereit" : "Ihr NEONTRIP Paket liegt zur Abholung bereit";
  const subject = orderLabel ? `${subjectPrefix} (${orderLabel})` : subjectPrefix;

  const details = [
    trackingNumber ? `<li><strong>Sendungsnummer:</strong> ${escapeHtml(trackingNumber)}</li>` : null,
    carrier ? `<li><strong>Versanddienstleister:</strong> ${escapeHtml(carrier)}</li>` : null,
    location ? `<li><strong>Ort laut Sendungsverfolgung:</strong> ${escapeHtml(location)}</li>` : null,
    statusText ? `<li><strong>Status:</strong> ${escapeHtml(statusText)}</li>` : null,
  ].filter(Boolean).join("");

  const bodyHtml = [
    paragraph(greeting(row)),
    paragraph(reminder
      ? "wir moechten Sie kurz daran erinnern, dass Ihr NEONTRIP Paket laut Sendungsverfolgung weiterhin zur Abholung bereitliegt."
      : "laut Sendungsverfolgung liegt Ihr NEONTRIP Paket aktuell zur Abholung bereit."),
    paragraph("Bitte holen Sie die Sendung zeitnah ab, damit sie nicht an uns zurueckgeschickt wird."),
    details ? `<ul>${details}</ul>` : "",
    trackingLink(row.tracking_url),
    paragraph("Falls Sie dazu Fragen haben, antworten Sie einfach auf diese E-Mail."),
    paragraph("Viele Gruesse"),
    FABIENNE_SIGNATURE_HTML,
  ].filter(Boolean).join("\n");

  return { recipientEmail, subject, bodyHtml };
}

export function buildInternalDeliveryProblemEmail(row: ClaimedShippingNotificationRow) {
  const recipientEmail = assertInternalRecipient(row.recipient_email);
  const trackingNumber = trimNullable(row.tracking_number) || "ohne Trackingnummer";
  const incidentTitle = trimNullable(row.incident_title) || "Shipping-Problem";
  const subject = `Shipping Warnung: ${incidentTitle} (${trackingNumber})`;
  const customer = trimNullable(row.customer_name) || "Unbekannter Kunde";
  const customerEmail = trimNullable(row.customer_email) || "Keine E-Mail";

  const facts = [
    ["Incident", incidentTitle],
    ["Severity", trimNullable(row.incident_severity) || "-"],
    ["Status", trimNullable(row.status) || "-"],
    ["Carrier", trimNullable(row.carrier)?.toUpperCase() || "-"],
    ["Tracking", trackingNumber],
    ["Shopify", trimNullable(row.shopify_order_number) || "-"],
    ["Request-ID", trimNullable(row.request_id) || "-"],
    ["Kunde", customer],
    ["Kunden-E-Mail", customerEmail],
    ["Letztes Event", trimNullable(row.latest_event_status_text) || "-"],
    ["Ort", trimNullable(row.latest_event_location) || "-"],
  ];

  const bodyHtml = [
    "<p><strong>Shipping-Fruehwarnung</strong></p>",
    paragraph("Diese Sendung ist nicht nur zur Abholung bereit, sondern hat ein Zustell- oder Ruecklaufproblem. Bitte intern pruefen, bevor der Kunde kontaktiert wird."),
    `<table>${facts.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`).join("")}</table>`,
    row.tracking_url ? trackingLink(row.tracking_url, "Carrier-Tracking oeffnen") : "",
    row.request_id ? trackingLink(`https://ops.neontrip.de/ops/customer-records/shipping?requestId=${encodeURIComponent(row.request_id)}`, "Shipping Board oeffnen") : "",
  ].filter(Boolean).join("\n");

  return { recipientEmail, subject, bodyHtml };
}

export function buildShippingNotificationEmail(row: ClaimedShippingNotificationRow): ShippingPreparedNotification {
  const email = row.kind === "customer_pickup_available"
    ? buildPickupAvailableCustomerEmail(row)
    : buildInternalDeliveryProblemEmail(row);

  return {
    notificationId: row.notification_id,
    notificationKey: row.notification_key,
    kind: row.kind,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    bodyHtml: email.bodyHtml,
    attempts: row.attempts,
  };
}

export async function enqueueShippingNotifications() {
  return supabaseRequest<Array<{ notification_id: string; notification_key: string; kind: ShippingNotificationKind; status: ShippingNotificationStatus }>>(
    "rpc/shipping_enqueue_notifications",
    {
      method: "POST",
      body: JSON.stringify({}),
      headers: { Prefer: "return=representation" },
    },
  );
}

export async function claimPendingShippingNotifications(limit = 20) {
  const rows = await supabaseRequest<ClaimedShippingNotificationRow[]>(
    "rpc/shipping_claim_pending_notifications",
    {
      method: "POST",
      body: JSON.stringify({ p_limit: Math.min(Math.max(limit, 1), 50) }),
      headers: { Prefer: "return=representation" },
    },
  );
  return rows.map(buildShippingNotificationEmail);
}

export async function markShippingNotificationSent(input: {
  notificationId: string;
  providerMessageId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const id = trimNullable(input.notificationId);
  if (!id) throw new QuoteValidationError("Shipping-Notification-ID fehlt.", [], 422);
  const [row] = await supabaseRequest<ShippingNotificationRow[]>(
    "rpc/shipping_mark_notification_sent",
    {
      method: "POST",
      body: JSON.stringify({
        p_notification_id: id,
        p_provider_message_id: trimNullable(input.providerMessageId),
        p_metadata: input.metadata || {},
      }),
      headers: { Prefer: "return=representation" },
    },
  );
  return row;
}

export async function markShippingNotificationFailed(input: {
  notificationId: string;
  error: string;
  metadata?: Record<string, unknown>;
}) {
  const id = trimNullable(input.notificationId);
  if (!id) throw new QuoteValidationError("Shipping-Notification-ID fehlt.", [], 422);
  const [row] = await supabaseRequest<ShippingNotificationRow[]>(
    "rpc/shipping_mark_notification_failed",
    {
      method: "POST",
      body: JSON.stringify({
        p_notification_id: id,
        p_error: trimNullable(input.error) || "unknown",
        p_metadata: input.metadata || {},
      }),
      headers: { Prefer: "return=representation" },
    },
  );
  return row;
}
