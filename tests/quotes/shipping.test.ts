import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarrierEventKey,
  buildShippingBoardFromRows,
  deriveShippingIncidentCandidates,
  normalizeCarrierStatus,
  normalizeShippingCarrier,
} from "../../src/lib/ops/shipping";
import { buildShippingNotificationEmail, type ClaimedShippingNotificationRow } from "../../src/lib/ops/shipping-notifications";

const baseShipment = {
  id: "shipment-1",
  shipment_key: "shopify:fulfillment-1:tracking-1",
  source: "shopify",
  shopify_order_id: "1001",
  shopify_order_number: "#1001",
  shopify_fulfillment_id: "fulfillment-1",
  request_id: "req-1",
  customer_name: "Ada Lovelace",
  customer_email: "ada@example.com",
  customer_phone: null,
  carrier: "dpd",
  tracking_number: "TRACK-1",
  tracking_url: "https://example.test/track",
  destination_country: "DE",
  status: "in_transit",
  status_reason: null,
  risk_level: "normal",
  shipped_at: "2026-06-01T08:00:00.000Z",
  delivered_at: null,
  last_event_at: "2026-06-01T09:00:00.000Z",
  last_carrier_sync_at: "2026-06-01T10:00:00.000Z",
  next_check_at: null,
  raw_shopify: {},
  created_at: "2026-06-01T08:00:00.000Z",
  updated_at: "2026-06-01T10:00:00.000Z",
} as const;

test("normalizeShippingCarrier recognizes DPD and DHL without treating unknown text as a known carrier", () => {
  assert.equal(normalizeShippingCarrier("DPD Classic"), "dpd");
  assert.equal(normalizeShippingCarrier("DHL Paket"), "dhl");
  assert.equal(normalizeShippingCarrier("Deutsche Post Warenpost"), "dhl");
  assert.equal(normalizeShippingCarrier("GLS"), "other");
  assert.equal(normalizeShippingCarrier(""), "unknown");
});

test("normalizeCarrierStatus separates delivery failure, pickup, return and delivered states", () => {
  assert.equal(normalizeCarrierStatus({ carrier: "dpd", statusText: "Paketshop - Abholung bereit" }), "pickup_available");
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Empfaenger nicht angetroffen - Zustellung fehlgeschlagen" }), "delivery_failed");
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Die Sendung wurde nicht zugestellt" }), "delivery_failed");
  assert.equal(normalizeCarrierStatus({ carrier: "dpd", statusText: "Paket konnte nicht zugestellt werden" }), "delivery_failed");
  assert.equal(normalizeCarrierStatus({ carrier: "dpd", statusText: "Zurueck an Absender" }), "returning");
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Ruecksendung zugestellt" }), "returned");
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Die Sendung wurde zugestellt" }), "delivered");
});

test("normalizeCarrierStatus maps Shopify fulfillment event statuses into shipping states", () => {
  assert.equal(normalizeCarrierStatus({ carrier: "shopify", statusCode: "ATTEMPTED_DELIVERY" }), "delivery_failed");
  assert.equal(normalizeCarrierStatus({ carrier: "shopify", statusCode: "READY_FOR_PICKUP" }), "pickup_available");
  assert.equal(normalizeCarrierStatus({ carrier: "shopify", statusCode: "OUT_FOR_DELIVERY" }), "out_for_delivery");
  assert.equal(normalizeCarrierStatus({ carrier: "shopify", statusCode: "CARRIER_PICKED_UP" }), "in_transit");
  assert.equal(normalizeCarrierStatus({ carrier: "shopify", statusCode: "LABEL_PURCHASED" }), "label_created");
  assert.equal(normalizeCarrierStatus({ carrier: "shopify", statusCode: "FAILURE" }), "delivery_failed");
});

test("buildCarrierEventKey is stable for duplicate carrier events and includes normalized carrier", () => {
  const event = {
    carrier: "DPD",
    trackingNumber: " 123456 ",
    carrierEventId: "scan-1",
    statusText: "Unterwegs",
    eventTime: "2026-06-05T09:30:00.000Z",
  };
  assert.equal(buildCarrierEventKey(event), buildCarrierEventKey({ ...event, carrier: "dpd" }));
  assert.match(buildCarrierEventKey(event), /^dpd:123456:scan-1:/);
});

test("deriveShippingIncidentCandidates flags stale in-transit shipments by business days", () => {
  const incidents = deriveShippingIncidentCandidates(
    {
      id: "shipment-1",
      carrier: "dpd",
      trackingNumber: "TRACK-1",
      status: "in_transit",
      shippedAt: "2026-06-01T08:00:00.000Z",
      lastEventAt: "2026-06-01T09:00:00.000Z",
    },
    {
      id: "event-1",
      eventTime: "2026-06-01T09:00:00.000Z",
      carrierStatusText: "Im Paketzentrum verarbeitet",
    },
    new Date("2026-06-05T10:00:00.000Z"),
  );

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].incidentType, "stale_in_transit");
  assert.equal(incidents[0].severity, "high");
});

test("deriveShippingIncidentCandidates escalates failed delivery and return-to-sender immediately", () => {
  const failed = deriveShippingIncidentCandidates(
    { id: "shipment-1", carrier: "dhl", trackingNumber: "TRACK-1", status: "delivery_failed", shippedAt: null, lastEventAt: null },
    { id: "event-1", eventTime: "2026-06-05T10:00:00.000Z", carrierStatusText: "Zustellung fehlgeschlagen" },
  );
  const returning = deriveShippingIncidentCandidates(
    { id: "shipment-1", carrier: "dpd", trackingNumber: "TRACK-1", status: "returning", shippedAt: null, lastEventAt: null },
    null,
  );

  assert.equal(failed[0].incidentType, "delivery_failed");
  assert.equal(failed[0].severity, "urgent");
  assert.equal(returning[0].incidentType, "return_to_sender");
  assert.equal(returning[0].severity, "urgent");
});

test("buildShippingBoardFromRows prioritizes urgent incidents and keeps tasks as projections", () => {
  const board = buildShippingBoardFromRows(
    [
      baseShipment as never,
      {
        ...baseShipment,
        id: "shipment-2",
        shipment_key: "shopify:fulfillment-2:tracking-2",
        tracking_number: "TRACK-2",
        status: "delivery_failed",
        risk_level: "urgent",
        updated_at: "2026-06-05T08:00:00.000Z",
      } as never,
    ],
    [
      {
        id: "incident-1",
        shipment_id: "shipment-2",
        request_id: "req-2",
        incident_key: "shipment-2:delivery_failed",
        incident_type: "delivery_failed",
        severity: "urgent",
        status: "open",
        title: "Zustellung fehlgeschlagen",
        description: null,
        first_detected_at: "2026-06-05T08:00:00.000Z",
        last_detected_at: "2026-06-05T08:00:00.000Z",
        resolved_at: null,
        rule_version: "test",
        source_event_id: null,
        active_task_id: "task-1",
        metadata: {},
        created_at: "2026-06-05T08:00:00.000Z",
        updated_at: "2026-06-05T08:00:00.000Z",
      } as never,
    ],
    [],
  );

  assert.equal(board.items[0].shipment.id, "shipment-2");
  assert.equal(board.counts.actionRequired, 1);
  assert.equal(board.counts.withOpenTask, 1);
});

test("buildShippingNotificationEmail sends pickup notices only as deterministic customer mail", () => {
  const notification = buildShippingNotificationEmail({
    notification_id: "notification-1",
    notification_key: "customer:pickup_available:shipment-1",
    kind: "customer_pickup_available",
    recipient_type: "customer",
    recipient_email: "ada@example.com",
    attempts: 1,
    shipment_id: "shipment-1",
    incident_id: "incident-1",
    shipment_key: "carrier:dpd:TRACK-1",
    shopify_order_number: "#1001",
    request_id: "req-1",
    customer_name: "Ada Lovelace",
    customer_email: "ada@example.com",
    carrier: "dpd",
    tracking_number: "TRACK-1",
    tracking_url: "https://example.test/track",
    status: "pickup_available",
    incident_type: "pickup_available",
    incident_title: "Paket liegt zur Abholung bereit",
    incident_description: "Paketshop.",
    incident_severity: "watch",
    latest_event_time: "2026-06-05T09:00:00.000Z",
    latest_event_location: "Paketshop Berlin",
    latest_event_status_text: "Abholung bereit",
  } as ClaimedShippingNotificationRow);

  assert.equal(notification.recipientEmail, "ada@example.com");
  assert.match(notification.subject, /Abholung bereit/);
  assert.match(notification.bodyHtml, /zeitnah ab/);
  assert.match(notification.bodyHtml, /Fabienne Trapp/);
  assert.match(notification.bodyHtml, /Beratung &amp; Realisierung/);
  assert.match(notification.bodyHtml, /\+49 211 54257240/);
  assert.match(notification.bodyHtml, /weiss_logo_NEONTRIP/);
  assert.doesNotMatch(notification.bodyHtml, /Daniel/);
});

test("buildShippingNotificationEmail labels pickup reminder mails clearly", () => {
  const notification = buildShippingNotificationEmail({
    notification_id: "notification-reminder-1",
    notification_key: "customer:pickup_available:shipment-1:reminder:1",
    kind: "customer_pickup_available",
    recipient_type: "customer",
    recipient_email: "ada@example.com",
    attempts: 1,
    shipment_id: "shipment-1",
    incident_id: "incident-1",
    shipment_key: "carrier:dpd:TRACK-1",
    shopify_order_number: "#1001",
    request_id: "req-1",
    customer_name: "Ada Lovelace",
    customer_email: "ada@example.com",
    carrier: "dpd",
    tracking_number: "TRACK-1",
    tracking_url: "https://example.test/track",
    status: "pickup_available",
    incident_type: "pickup_available",
    incident_title: "Paket liegt zur Abholung bereit",
    incident_description: "Paketshop.",
    incident_severity: "watch",
    latest_event_time: "2026-06-05T09:00:00.000Z",
    latest_event_location: "Paketshop Berlin",
    latest_event_status_text: "Abholung bereit",
  } as ClaimedShippingNotificationRow);

  assert.match(notification.subject, /^Erinnerung:/);
  assert.match(notification.bodyHtml, /weiterhin zur Abholung bereitliegt/);
  assert.match(notification.bodyHtml, /Fabienne Trapp/);
});

test("buildShippingNotificationEmail blocks customer pickup mails to internal or test addresses", () => {
  assert.throws(
    () => buildShippingNotificationEmail({
      notification_id: "notification-1",
      notification_key: "customer:pickup_available:shipment-1",
      kind: "customer_pickup_available",
      recipient_type: "customer",
      recipient_email: "support@neontrip.de",
      attempts: 1,
      shipment_id: "shipment-1",
      incident_id: "incident-1",
      shipment_key: "carrier:dpd:TRACK-1",
      shopify_order_number: "#1001",
      request_id: "req-1",
      customer_name: "Ada Lovelace",
      customer_email: "support@neontrip.de",
      carrier: "dpd",
      tracking_number: "TRACK-1",
      tracking_url: "https://example.test/track",
      status: "pickup_available",
      incident_type: "pickup_available",
      incident_title: "Paket liegt zur Abholung bereit",
      incident_description: "Paketshop.",
      incident_severity: "watch",
      latest_event_time: "2026-06-05T09:00:00.000Z",
      latest_event_location: "Paketshop Berlin",
      latest_event_status_text: "Abholung bereit",
    } as ClaimedShippingNotificationRow),
    /interne oder Test-Adressen/,
  );
});

test("buildShippingNotificationEmail routes return and failed delivery as internal warnings", () => {
  const notification = buildShippingNotificationEmail({
    notification_id: "notification-2",
    notification_key: "internal:delivery_problem:incident-2",
    kind: "internal_delivery_problem",
    recipient_type: "internal",
    recipient_email: "info@neontrip.de",
    attempts: 1,
    shipment_id: "shipment-2",
    incident_id: "incident-2",
    shipment_key: "carrier:dhl:TRACK-2",
    shopify_order_number: "#1002",
    request_id: "req-2",
    customer_name: "Max Mustermann",
    customer_email: "max@example.com",
    carrier: "dhl",
    tracking_number: "TRACK-2",
    tracking_url: "https://example.test/track-2",
    status: "returning",
    incident_type: "return_to_sender",
    incident_title: "Sendung kommt zurueck",
    incident_description: "Ruecksendung.",
    incident_severity: "urgent",
    latest_event_time: "2026-06-05T09:00:00.000Z",
    latest_event_location: "Depot",
    latest_event_status_text: "Zurueck an Absender",
  } as ClaimedShippingNotificationRow);

  assert.equal(notification.recipientEmail, "info@neontrip.de");
  assert.match(notification.subject, /Shipping Warnung/);
  assert.match(notification.bodyHtml, /intern pruefen/);
  assert.match(notification.bodyHtml, /TRACK-2/);
});
