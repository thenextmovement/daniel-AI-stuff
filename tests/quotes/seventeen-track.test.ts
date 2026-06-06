import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInboundCarrierStatus } from "../../src/lib/ops/inbound-shipping";
import {
  buildInboundCarrierPayloadFrom17Track,
  parse17TrackRegistrationResult,
} from "../../src/lib/ops/seventeen-track";

test("normalizeInboundCarrierStatus maps 17TRACK status codes into inbound states", () => {
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "OutForDelivery" }), "out_for_delivery");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "InfoReceived" }), "label_created");
  assert.equal(normalizeInboundCarrierStatus({ carrier: "17track", statusCode: "Expired" }), "exception");
});

test("buildInboundCarrierPayloadFrom17Track maps tagged 17TRACK events into carrier response payloads", () => {
  const payload = buildInboundCarrierPayloadFrom17Track({
    event: "TRACKING_UPDATED",
    data: {
      number: "3328106036",
      carrier: 100001,
      tag: "25d72523-b171-4267-98e0-2b9859c0feb2",
      track_info: {
        latest_status: { status: "InTransit", sub_status: "Clearance event" },
        tracking: {
          providers: [
            {
              events: [
                {
                  time_iso: "2026-06-06T10:30:00+02:00",
                  description: "Clearance event - additional information required",
                  location: { city: "Leipzig", country: "DE" },
                },
              ],
            },
          ],
        },
      },
    },
  });

  assert.equal(payload?.shipmentId, "25d72523-b171-4267-98e0-2b9859c0feb2");
  assert.equal(payload?.trackingNumber, "3328106036");
  assert.equal(payload?.events.length, 1);
  assert.equal(payload?.events[0]?.statusText, "Clearance event - additional information required");
  assert.equal(payload?.events[0]?.eventLocation, "Leipzig, DE");
});

test("parse17TrackRegistrationResult records accepted registrations with provider carrier id", () => {
  const result = parse17TrackRegistrationResult(
    {
      code: 0,
      data: {
        accepted: [{ number: "3328106036", carrier: 100001 }],
        rejected: [],
      },
    },
    {
      shipment_id: "25d72523-b171-4267-98e0-2b9859c0feb2",
      registration_id: "registration-1",
      carrier: "dhl",
      tracking_number: "3328106036",
      trello_card_name: "China Los",
      trello_card_url: null,
      attempts: 1,
    },
  );

  assert.equal(result.status, "accepted");
  assert.equal(result.providerCarrierId, 100001);
  assert.equal(result.shipmentId, "25d72523-b171-4267-98e0-2b9859c0feb2");
});
