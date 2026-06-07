import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInboundCarrierStatus } from "../../src/lib/ops/inbound-shipping";
import {
  build17TrackSyncCarrierPayload,
  buildInboundCarrierPayloadFrom17Track,
  build17TrackRegistrationItem,
  default17TrackCarrierId,
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

test("buildInboundCarrierPayloadFrom17Track reads gettrackinfo accepted envelopes", () => {
  const payload = buildInboundCarrierPayloadFrom17Track({
    code: 0,
    data: {
      accepted: [
        {
          number: "3328106036",
          carrier: 7041,
          tag: "25d72523-b171-4267-98e0-2b9859c0feb2",
          track_info: {
            latest_status: { status: "InTransit" },
            tracking: {
              providers: [
                {
                  events: [
                    {
                      time_iso: "2026-06-06T10:30:00+02:00",
                      description: "Shipment picked up",
                      location: { city: "Hong Kong", country_code: "HK" },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      rejected: [],
    },
  });

  assert.equal(payload?.shipmentId, "25d72523-b171-4267-98e0-2b9859c0feb2");
  assert.equal(payload?.trackingNumber, "3328106036");
  assert.equal(payload?.events.length, 1);
  assert.equal(payload?.events[0]?.statusText, "Shipment picked up");
});

test("build17TrackSyncCarrierPayload keeps the original inbound carrier and shipment id", () => {
  const payload = build17TrackSyncCarrierPayload(
    {
      code: 0,
      data: {
        accepted: [
          {
            number: "3328106036",
            carrier: 7041,
            track_info: {
              latest_status: { status: "InTransit" },
              tracking: {
                providers: [
                  {
                    events: [
                      {
                        time_iso: "2026-06-06T10:30:00+02:00",
                        description: "Arrived at sort facility",
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    },
    {
      shipment_id: "25d72523-b171-4267-98e0-2b9859c0feb2",
      shipment_key: "trello:card:dhl:3328106036",
      carrier: "dhl",
      tracking_number: "3328106036",
      provider_carrier_id: 7041,
      provider_tag: "25d72523-b171-4267-98e0-2b9859c0feb2",
      trello_card_id: "card-1",
      trello_card_name: "China Los",
      trello_card_url: null,
      status: "tracking_created",
    },
  );

  assert.equal(payload?.carrier, "dhl");
  assert.equal(payload?.shipmentId, "25d72523-b171-4267-98e0-2b9859c0feb2");
  assert.equal(payload?.trackingNumber, "3328106036");
  assert.equal(payload?.events.length, 1);
});

test("buildInboundCarrierPayloadFrom17Track uses a stable event key for latest-status snapshots", () => {
  const snapshot = {
    code: 0,
    data: {
      accepted: [
        {
          number: "3328106036",
          carrier: 7041,
          track_info: {
            latest_status: { status: "NotFound", sub_status: "NotFound_Other" },
          },
        },
      ],
    },
  };

  const first = buildInboundCarrierPayloadFrom17Track(snapshot);
  const second = buildInboundCarrierPayloadFrom17Track(snapshot);

  assert.equal(first?.events.length, 1);
  assert.equal(first?.events[0]?.eventKey, "inbound:17track:3328106036:latest:notfound:notfound-other");
  assert.equal(first?.events[0]?.eventKey, second?.events[0]?.eventKey);
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

test("build17TrackRegistrationItem uses explicit carrier ids for known inbound carriers", () => {
  assert.equal(default17TrackCarrierId("dhl"), 7041);
  assert.equal(default17TrackCarrierId("fedex"), 100003);

  const item = build17TrackRegistrationItem({
    shipment_id: "25d72523-b171-4267-98e0-2b9859c0feb2",
    registration_id: "registration-1",
    carrier: "dhl",
    tracking_number: "3328106036",
    trello_card_name: "China Los",
    trello_card_url: null,
    attempts: 1,
  });

  assert.equal(item.number, "3328106036");
  assert.equal(item.carrier, 7041);
  assert.equal(item.tag, "25d72523-b171-4267-98e0-2b9859c0feb2");
  assert.equal(item.note, "China Los");
});

test("parse17TrackRegistrationResult matches batch results and extracts nested rejected errors", () => {
  const result = parse17TrackRegistrationResult(
    {
      code: 0,
      data: {
        accepted: [{ number: "3328106036", carrier: 7041, tag: "25d72523-b171-4267-98e0-2b9859c0feb2" }],
        rejected: [
          {
            number: "871030317880",
            tag: "2c68b5d7-c00f-4f9f-8b5b-88137e08507b",
            error: { code: -18019903, message: "Carrier cannot be detected." },
          },
        ],
      },
    },
    {
      shipment_id: "2c68b5d7-c00f-4f9f-8b5b-88137e08507b",
      registration_id: "registration-2",
      carrier: "fedex",
      tracking_number: "871030317880",
      trello_card_name: "FedEx inbound",
      trello_card_url: null,
      attempts: 1,
    },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.providerCarrierId, 100003);
  assert.equal(result.error, "Carrier cannot be detected.");
});
