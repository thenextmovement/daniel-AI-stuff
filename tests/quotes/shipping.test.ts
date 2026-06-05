import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarrierEventKey,
  buildShippingBoardFromRows,
  deriveShippingIncidentCandidates,
  normalizeCarrierStatus,
  normalizeShippingCarrier,
} from "../../src/lib/ops/shipping";

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
