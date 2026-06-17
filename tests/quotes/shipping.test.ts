import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarrierEventKey,
  buildShippingBoardFromRows,
  deriveShippingIncidentCandidates,
  isInternalShippingProblemIncident,
  normalizeCarrierStatus,
  normalizeShippingCarrier,
} from "../../src/lib/ops/shipping";
import {
  buildInboundBoardFromRows,
  generateInboundDeliveryNotePdf,
  listInboundBoard,
  normalizeInboundCarrierStatus,
  parseInboundTrackingValue,
  selectInboundTrelloVisualAttachment,
} from "../../src/lib/ops/inbound-shipping";
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

test("normalizeCarrierStatus never treats label-only or unknown carrier text as in transit", () => {
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Shipment information received" }), "label_created");
  assert.equal(normalizeCarrierStatus({ carrier: "dpd", statusText: "Pre-advice received" }), "label_created");
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Label created" }), "label_created");
  assert.equal(normalizeCarrierStatus({ carrier: "dhl", statusText: "Pending carrier update" }), "carrier_not_found");
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

test("deriveShippingIncidentCandidates ignores shipments outside the 60 day shipping window", () => {
  const incidents = deriveShippingIncidentCandidates(
    {
      id: "shipment-old",
      carrier: "dpd",
      trackingNumber: "TRACK-OLD",
      status: "delivery_failed",
      shippedAt: "2026-03-01T08:00:00.000Z",
      lastEventAt: "2026-03-02T09:00:00.000Z",
      createdAt: "2026-03-01T08:00:00.000Z",
      updatedAt: "2026-03-02T09:00:00.000Z",
    },
    {
      id: "event-old",
      eventTime: "2026-03-02T09:00:00.000Z",
      carrierStatusText: "Zustellung fehlgeschlagen",
    },
    new Date("2026-06-05T10:00:00.000Z"),
  );

  assert.equal(incidents.length, 0);
});

test("pickup incidents are customer notices, not internal delivery problems", () => {
  assert.equal(isInternalShippingProblemIncident({ incidentType: "pickup_available", status: "open" }), false);
  assert.equal(isInternalShippingProblemIncident({ incidentType: "delivery_failed", status: "open" }), true);
  assert.equal(isInternalShippingProblemIncident({ incidentType: "return_to_sender", status: "acknowledged" }), true);
  assert.equal(isInternalShippingProblemIncident({ incidentType: "returned", status: "resolved" }), false);
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
  assert.equal(board.counts.labelCreated, 0);
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

test("parseInboundTrackingValue extracts DHL Express and FedEx tracking numbers from Trello custom fields", () => {
  const dhl = parseInboundTrackingValue("DHL Express 123 456 7890");
  const fedex = parseInboundTrackingValue("FedEx 1234-5678-9012");

  assert.equal(dhl.valid, true);
  assert.equal(dhl.carrier, "dhl");
  assert.equal(dhl.trackingNumber, "1234567890");
  assert.equal(fedex.valid, true);
  assert.equal(fedex.carrier, "fedex");
  assert.equal(fedex.trackingNumber, "123456789012");
});

test("normalizeInboundCarrierStatus maps clearance, out-for-delivery and label-only states", () => {
  assert.equal(normalizeInboundCarrierStatus({ carrier: "fedex", statusCode: "CD", statusText: "Clearance delay - additional information required" }), "clearance_action_required");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "dhl", statusCode: "CP", statusText: "Clearance event in progress" }), "clearance_in_progress");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "Exception", statusText: "Clearance Event" }), "clearance_in_progress");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "InTransit", statusText: "Customs clearance status updated. Note - The Customs clearance process may start while the shipment is in transit to the destination." }), "in_transit");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "InTransit", statusText: "Processed for clearance at LEIPZIG - GERMANY" }), "in_transit");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "fedex", statusCode: "OD", statusText: "On vehicle for delivery" }), "out_for_delivery");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "dhl", statusText: "Shipment is out with courier for delivery" }), "out_for_delivery");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "dhl", statusText: "Shipment information sent to DHL" }), "label_created");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "InfoReceived" }), "label_created");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusText: "Pre-advice received" }), "label_created");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusText: "Pending update" }), "carrier_not_found");
});

test("selectInboundTrelloVisualAttachment prefers image.png before mockups and other images", () => {
  const selected = selectInboundTrelloVisualAttachment([
    { id: "mockup", name: "Mockup 1.png", url: "https://example.test/mockup.png" },
    { id: "other", name: "photo.webp", url: "https://example.test/photo.webp", mimeType: "image/webp" },
    { id: "reference", name: "image.png", url: "https://example.test/image.png" },
  ]);

  assert.equal(selected?.id, "reference");
});

test("buildInboundBoardFromRows prioritizes urgent inbound incidents and counts operational states", () => {
  const baseInboundShipment = {
    id: "inbound-1",
    shipment_key: "trello:card-1:dhl:1234567890",
    source: "trello",
    trello_card_id: "card-1",
    trello_card_name: "China Los 1",
    trello_card_url: "https://trello.example/card-1",
    trello_list_id: "list-1",
    trello_list_name: "sign shipped",
    carrier: "dhl",
    tracking_number: "1234567890",
    tracking_raw: "DHL 1234567890",
    status: "in_transit",
    status_reason: null,
    risk_level: "normal",
    first_seen_at: "2026-06-01T08:00:00.000Z",
    tracking_first_seen_at: "2026-06-01T08:00:00.000Z",
    tendered_at: null,
    last_event_at: "2026-06-02T08:00:00.000Z",
    last_movement_at: "2026-06-02T08:00:00.000Z",
    last_checked_at: "2026-06-02T09:00:00.000Z",
    next_check_at: null,
    delivered_at: null,
    created_at: "2026-06-01T08:00:00.000Z",
    updated_at: "2026-06-02T09:00:00.000Z",
  } as const;

  const board = buildInboundBoardFromRows(
    [
      baseInboundShipment as never,
      {
        ...baseInboundShipment,
        id: "inbound-2",
        shipment_key: "trello:card-2:fedex:123456789012",
        trello_card_id: "card-2",
        trello_card_name: "China Los 2",
        carrier: "fedex",
        tracking_number: "123456789012",
        tracking_raw: "FedEx 123456789012",
        status: "clearance_action_required",
        risk_level: "urgent",
        updated_at: "2026-06-05T08:00:00.000Z",
      } as never,
      {
        ...baseInboundShipment,
        id: "inbound-3",
        shipment_key: "trello:card-3:dhl:9876543210",
        tracking_number: "9876543210",
        status: "out_for_delivery",
        risk_level: "high",
      } as never,
    ],
    [
      {
        id: "incident-1",
        shipment_id: "inbound-2",
        incident_key: "inbound:inbound-2:clearance_action_required",
        incident_type: "clearance_action_required",
        severity: "urgent",
        status: "open",
        title: "Clearance Event: Aktion erforderlich",
        description: "Additional information required.",
        first_detected_at: "2026-06-05T08:00:00.000Z",
        last_detected_at: "2026-06-05T08:00:00.000Z",
        resolved_at: null,
        rule_version: "test",
        source_event_id: null,
        active_task_id: "task-1",
        created_at: "2026-06-05T08:00:00.000Z",
        updated_at: "2026-06-05T08:00:00.000Z",
      } as never,
      {
        id: "incident-2",
        shipment_id: "inbound-1",
        incident_key: "inbound:inbound-1:clearance_watch",
        incident_type: "clearance_watch",
        severity: "watch",
        status: "resolved",
        title: "Zollvorgang beobachten",
        description: "Old clearance watch should not inflate the clearance counter once shipment is in transit.",
        first_detected_at: "2026-06-05T08:00:00.000Z",
        last_detected_at: "2026-06-05T08:00:00.000Z",
        resolved_at: "2026-06-05T09:00:00.000Z",
        rule_version: "test",
        source_event_id: null,
        active_task_id: null,
        created_at: "2026-06-05T08:00:00.000Z",
        updated_at: "2026-06-05T08:00:00.000Z",
      } as never,
      {
        id: "incident-3",
        shipment_id: "inbound-1",
        incident_key: "inbound:inbound-1:tracking_error",
        incident_type: "tracking_error",
        severity: "urgent",
        status: "resolved",
        title: "Tracking API Fehler",
        description: "DHL konnte nicht abgefragt werden.",
        first_detected_at: "2026-06-05T08:00:00.000Z",
        last_detected_at: "2026-06-05T08:00:00.000Z",
        resolved_at: "2026-06-05T09:00:00.000Z",
        rule_version: "test",
        source_event_id: null,
        active_task_id: "task-2",
        created_at: "2026-06-05T08:00:00.000Z",
        updated_at: "2026-06-05T09:00:00.000Z",
      } as never,
    ],
    [],
  );

  assert.equal(board.items[0].shipment.id, "inbound-2");
  assert.equal(board.items.find((item) => item.shipment.id === "inbound-1")?.incidents.length, 0);
  assert.equal(board.counts.actionRequired, 1);
  assert.equal(board.counts.labelCreated, 0);
  assert.equal(board.counts.acceptedByCarrier, 0);
  assert.equal(board.counts.inTransit, 3);
  assert.equal(board.counts.clearance, 1);
  assert.equal(board.counts.outForDelivery, 1);
  assert.equal(board.counts.withOpenTask, 1);
});

test("listInboundBoard filters inbound shipments by linked requestId", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
  };
  let inboundShipmentQuery: URLSearchParams | null = null;

  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (path.endsWith("/rest/v1/master_requests")) {
      if (url.searchParams.get("request_id") === "eq.REQ-1") {
        return json([{ id: "internal-1", request_id: "REQ-1", trello_card_id: "card-filtered", updated_at: "2026-06-05T08:00:00.000Z" }]);
      }
      if (url.searchParams.get("trello_card_id") === "in.(card-filtered)") {
        return json([{ id: "internal-1", request_id: "REQ-1", trello_card_id: "card-filtered", updated_at: "2026-06-05T08:00:00.000Z" }]);
      }
      return json([]);
    }

    if (path.endsWith("/rest/v1/inbound_shipments")) {
      inboundShipmentQuery = url.searchParams;
      return json([
        {
          id: "inbound-filtered",
          shipment_key: "trello:card-filtered:dhl:1234567890",
          source: "trello",
          trello_card_id: "card-filtered",
          trello_card_name: "Filtered request",
          trello_card_url: "https://trello.example/card-filtered",
          trello_list_id: "list-1",
          trello_list_name: "sign shipped",
          carrier: "dhl",
          tracking_number: "1234567890",
          tracking_raw: "DHL 1234567890",
          status: "in_transit",
          status_reason: null,
          risk_level: "normal",
          first_seen_at: "2026-06-01T08:00:00.000Z",
          tracking_first_seen_at: "2026-06-01T08:00:00.000Z",
          tendered_at: "2026-06-01T09:00:00.000Z",
          last_event_at: "2026-06-02T08:00:00.000Z",
          last_movement_at: "2026-06-02T08:00:00.000Z",
          last_checked_at: "2026-06-02T09:00:00.000Z",
          next_check_at: null,
          delivered_at: null,
          created_at: "2026-06-01T08:00:00.000Z",
          updated_at: "2026-06-02T09:00:00.000Z",
        },
      ]);
    }

    if (path.endsWith("/rest/v1/inbound_incidents") || path.endsWith("/rest/v1/inbound_tracking_events")) return json([]);
    if (path.endsWith("/rest/v1/master_orders")) {
      return json([
        {
          id: "order-1",
          request_id: "internal-1",
          shopify_order_id: "8281257672971",
          shopify_order_number: "#NEONT4426",
          created_at: "2026-06-08T16:00:32.249981+00:00",
          shopify_created_at: "2026-06-08T15:30:57+00:00",
        },
      ]);
    }
    if (path.endsWith("/rest/v1/crm_sales")) return json([]);
    if (path.endsWith("/rest/v1/supplier_sales")) {
      return json([
        {
          id: "supplier-sale-1",
          request_id: null,
          trello_card_id: "card-filtered",
          shopify_order_id: "8281257672972",
          shopify_order_name: "#NEONT4427",
          shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/8281257672972",
          created_at: "2026-06-08T17:00:32.249981+00:00",
          updated_at: "2026-06-08T17:05:32.249981+00:00",
        },
      ]);
    }
    if (path.endsWith("/rest/v1/crm_quotes")) {
      return json([{ id: "quote-1", request_id: "internal-1", quote_number: "Q-1", status: "sent", created_at: "2026-06-05T08:00:00.000Z" }]);
    }
    if (path.endsWith("/rest/v1/crm_quote_versions")) {
      return json([{ id: "version-1", quote_id: "quote-1", label: "v1", created_at: "2026-06-05T08:00:00.000Z" }]);
    }
    if (path.endsWith("/rest/v1/crm_quote_version_images")) {
      return json([{ id: "image-1", version_id: "version-1", item_index: 0, image_index: 0, original_url: "https://cdn.example.test/image.png", copied_url: null, versioned_url: null, created_at: "2026-06-05T08:00:00.000Z" }]);
    }

    return new Response(JSON.stringify({ error: `unexpected ${path}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const board = await listInboundBoard({ requestId: "REQ-1", scope: "all" });

    assert.equal(board.items.length, 1);
    assert.equal(board.items[0]?.shipment.trelloCardId, "card-filtered");
    const shipmentQuery = inboundShipmentQuery as URLSearchParams | null;
    assert.ok(shipmentQuery);
    assert.equal(shipmentQuery.get("trello_card_id"), "in.(card-filtered)");
    assert.deepEqual(board.items[0]?.shopifyOrder, {
      orderId: "8281257672972",
      orderNumber: "#NEONT4427",
      url: "https://galaxybuzzdk.myshopify.com/admin/orders/8281257672972",
      source: "supplier_sales",
      matchedBy: "supplier_sales_trello_card",
      matchLabel: "Trello -> supplier_sales",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("listInboundBoard matches Shopify orders through NEONTRIP offer references when names do not match", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
  };

  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const path = url.pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (path.endsWith("/rest/v1/inbound_shipments")) {
      return json([
        {
          id: "inbound-offer-match",
          shipment_key: "trello:card-offer-match:dhl:2992676864",
          source: "trello",
          trello_card_id: "card-offer-match",
          trello_card_name: "Inbound China Paket",
          trello_card_url: "https://trello.example/card-offer-match",
          trello_list_id: "list-1",
          trello_list_name: "sign shipped",
          carrier: "dhl",
          tracking_number: "2992676864",
          tracking_raw: "DHL Express 2992676864",
          status: "out_for_delivery",
          status_reason: null,
          risk_level: "normal",
          first_seen_at: "2026-06-15T08:00:00.000Z",
          tracking_first_seen_at: "2026-06-15T08:00:00.000Z",
          tendered_at: "2026-06-15T09:00:00.000Z",
          last_event_at: "2026-06-17T07:00:00.000Z",
          last_movement_at: "2026-06-17T07:00:00.000Z",
          last_checked_at: "2026-06-17T07:10:00.000Z",
          next_check_at: null,
          delivered_at: null,
          created_at: "2026-06-15T08:00:00.000Z",
          updated_at: "2026-06-17T07:10:00.000Z",
        },
      ]);
    }

    if (path.endsWith("/rest/v1/inbound_incidents") || path.endsWith("/rest/v1/inbound_tracking_events")) return json([]);
    if (path.endsWith("/rest/v1/master_requests")) {
      return json([{ id: "request-offer-match", request_id: "REQ-OFFER", trello_card_id: "card-offer-match", updated_at: "2026-06-15T08:00:00.000Z" }]);
    }
    if (path.endsWith("/rest/v1/crm_quotes")) {
      return json([{ id: "offer-match-1", request_id: "request-offer-match", quote_number: "A/N 14061", status: "accepted", created_at: "2026-06-15T08:30:00.000Z" }]);
    }
    if (path.endsWith("/rest/v1/crm_quote_versions") || path.endsWith("/rest/v1/crm_quote_version_images")) return json([]);
    if (path.endsWith("/rest/v1/master_orders") || path.endsWith("/rest/v1/crm_sales")) return json([]);
    if (path.endsWith("/rest/v1/supplier_sales")) {
      if (url.searchParams.get("offer_id") === "in.(offer-match-1)") {
        return json([
          {
            id: "supplier-sale-offer-match",
            request_id: null,
            trello_card_id: null,
            shopify_order_id: "8281257672999",
            shopify_order_name: "#NEONT4499",
            shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/8281257672999",
            offer_id: "offer-match-1",
            offer_number: "A/N 14061",
            document_reference: "A/N 14061",
            idempotency_key: "offer:offer-match-1:shopify-sale:v1",
            customer_name: "Completely Different Shopify Name",
            created_at: "2026-06-15T09:00:00.000Z",
            updated_at: "2026-06-15T09:10:00.000Z",
          },
        ]);
      }
      return json([]);
    }

    return new Response(JSON.stringify({ error: `unexpected ${path}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const board = await listInboundBoard({ scope: "all" });

    assert.equal(board.items.length, 1);
    assert.deepEqual(board.items[0]?.shopifyOrder, {
      orderId: "8281257672999",
      orderNumber: "#NEONT4499",
      url: "https://galaxybuzzdk.myshopify.com/admin/orders/8281257672999",
      source: "supplier_sales",
      matchedBy: "supplier_sales_offer_id",
      matchLabel: "Offer ID offer-match-1",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("generateInboundDeliveryNotePdf creates a NEONTRIP delivery note without price data", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
  };

  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.SHOPIFY_SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const path = url.pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (path.endsWith("/rest/v1/inbound_shipments")) {
      return json([
        {
          id: "inbound-lieferschein-1",
          shipment_key: "trello:card-lieferschein:dhl:2992676864",
          source: "trello",
          trello_card_id: "card-lieferschein",
          trello_card_name: "Clara Schwarz - Neon Logo",
          trello_card_url: "https://trello.example/card-lieferschein",
          trello_list_id: "list-sign-shipped",
          trello_list_name: "sign shipped",
          carrier: "dhl",
          tracking_number: "2992676864",
          tracking_raw: "DHL Express 2992676864",
          status: "out_for_delivery",
          status_reason: null,
          risk_level: "high",
          first_seen_at: "2026-06-15T08:00:00.000Z",
          tracking_first_seen_at: "2026-06-15T08:00:00.000Z",
          tendered_at: "2026-06-15T09:00:00.000Z",
          last_event_at: "2026-06-17T07:00:00.000Z",
          last_movement_at: "2026-06-17T07:00:00.000Z",
          last_checked_at: "2026-06-17T07:10:00.000Z",
          next_check_at: null,
          delivered_at: null,
          created_at: "2026-06-15T08:00:00.000Z",
          updated_at: "2026-06-17T07:10:00.000Z",
        },
      ]);
    }

    if (path.endsWith("/rest/v1/inbound_tracking_events")) {
      return json([
        {
          id: "event-lieferschein-1",
          shipment_id: "inbound-lieferschein-1",
          event_key: "dhl:2992676864:out-for-delivery",
          carrier: "dhl",
          carrier_event_id: "out-for-delivery",
          event_time: "2026-06-17T07:00:00.000Z",
          location: "Düsseldorf",
          carrier_status_code: "OD",
          carrier_status_text: "Shipment is out with courier for delivery",
          normalized_status: "out_for_delivery",
          raw_event: {},
          created_at: "2026-06-17T07:10:00.000Z",
        },
      ]);
    }

    if (path.endsWith("/rest/v1/master_requests")) {
      return json([{ id: "request-internal-1", request_id: "REQ-1", trello_card_id: "card-lieferschein", updated_at: "2026-06-15T08:00:00.000Z" }]);
    }
    if (path.endsWith("/rest/v1/master_orders") || path.endsWith("/rest/v1/crm_sales")) return json([]);
    if (path.endsWith("/rest/v1/supplier_sales")) {
      return json([
        {
          id: "supplier-sale-lieferschein-1",
          request_id: "request-internal-1",
          trello_card_id: "card-lieferschein",
          shopify_order_id: "8281257672972",
          shopify_order_name: "#NEONT4427",
          shopify_order_url: "https://galaxybuzzdk.myshopify.com/admin/orders/8281257672972",
          offer_number: "A/N 14061",
          customer_name: "Clara Schwarz",
          customer_company: "Schwarz Events GmbH",
          customer_email: "clara@example.test",
          offer_snapshot: {
            customer: { company: "Schwarz Events GmbH", email: "clara@example.test" },
            deliveryAddress: {
              company: "Schwarz Events GmbH",
              name: "Clara Schwarz",
              address1: "Musterstraße 12",
              zip: "40210",
              city: "Düsseldorf",
              country: "Deutschland",
            },
            lineItems: [
              {
                title: "LED Schriftzug Clara",
                description: "Interne Notiz: Netto 1000.00 EUR, Brutto 1190.00 EUR",
                quantity: 2,
              },
            ],
            totalGross: 1190,
            currency: "EUR",
          },
          raw_shopify: {
            shipping_address: {
              company: "Schwarz Events GmbH",
              name: "Clara Schwarz",
              address1: "Musterstraße 12",
              zip: "40210",
              city: "Düsseldorf",
              country: "Deutschland",
            },
          },
          created_at: "2026-06-15T08:00:00.000Z",
          updated_at: "2026-06-15T09:00:00.000Z",
        },
      ]);
    }
    if (path.endsWith("/rest/v1/supplier_sale_items")) {
      return json([
        {
          id: "item-lieferschein-1",
          sale_id: "supplier-sale-lieferschein-1",
          title: "Fallback Artikel mit Preisnotiz",
          quantity: 1,
          raw_line_item: { variant_title: "Variante fuer 1000.00 EUR" },
        },
      ]);
    }

    return new Response(JSON.stringify({ error: `unexpected ${path}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const pdf = await generateInboundDeliveryNotePdf("inbound-lieferschein-1");
    const content = Buffer.from(pdf.bytes).toString("latin1");

    assert.match(pdf.fileName, /^lieferschein-/);
    assert.match(content, /^%PDF-1\.4/);
    assert.match(content, /NEONTRIP/);
    assert.match(content, /Lieferschein/);
    assert.match(content, /2992676864/);
    assert.match(content, /LED Schriftzug Clara/);
    assert.match(content, /#NEONT4427/);
    assert.doesNotMatch(content, /1000\.00/);
    assert.doesNotMatch(content, /1190\.00/);
    assert.doesNotMatch(content, /\bEUR\b/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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
