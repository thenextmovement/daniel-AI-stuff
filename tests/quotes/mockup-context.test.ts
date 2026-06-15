import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImageMockupPrompt,
  buildMockupContext,
  buildMockupTrelloDescription,
  buildVideoMockupPrompt,
  canAutoUpdateTrelloDescription,
  inferRequestSegmentForStorage,
  MOCKUP_TRELLO_DESCRIPTION_MARKER,
  resolveMockupSegment,
} from "@/lib/ops/mockup-context";

test("mockup context infers cafe setting from lead text and avoids generic segment labels", () => {
  const context = buildMockupContext({
    customerCompany: "Mila Coffee",
    customerEmail: "hello@mila-coffee.de",
    requestTitle: "Neonschild fuer Cafe Theke",
    requestDescription: "Wir brauchen ein Logo fuer unseren Coffee Shop Tresen.",
    color: "warmweiss",
    usage: "Innenbereich",
  });

  assert.equal(context.segment, "Cafe / Coffee Shop");
  assert.equal(context.source, "ai");
  assert.match(context.setting, /Tresenbereich/);
  assert.doesNotMatch(context.setting.toLowerCase(), /\b(kleines unternehmen|firma|business|kunde|gewerbe|sonstiges|allgemein|unbekannt)\b/);
});

test("manual segment wins over inferred text segment", () => {
  const segment = resolveMockupSegment({
    manualSegment: "Fitnessstudio",
    requestDescription: "Restaurant mit warmer Gastro-Beleuchtung",
  });

  assert.equal(segment.segment, "Fitnessstudio");
  assert.equal(segment.source, "manual");
  assert.equal(segment.confidence, 1);
});

test("unclear leads fall back to neutral visual showroom setting without storing a generic segment", () => {
  const context = buildMockupContext({
    customerCompany: "Muster GmbH",
    customerEmail: "info@example.com",
    requestDescription: "Wir haetten gerne ein Schild.",
  });
  const storage = inferRequestSegmentForStorage({
    customerCompany: "Muster GmbH",
    customerEmail: "info@example.com",
    requestDescription: "Wir haetten gerne ein Schild.",
  });

  assert.equal(context.segment, "Showroom");
  assert.equal(context.source, "fallback");
  assert.match(context.setting, /Ladenlokal \/ Showroom|Praesentationsflaeche/);
  assert.deepEqual(storage, {
    segment: null,
    sKategorie: null,
    source: "fallback",
    confidence: 0.4,
  });
});

test("trello description protects manual text and marks auto-generated descriptions", () => {
  assert.equal(canAutoUpdateTrelloDescription(""), true);
  assert.equal(canAutoUpdateTrelloDescription(`${MOCKUP_TRELLO_DESCRIPTION_MARKER}\nalt`), true);
  assert.equal(canAutoUpdateTrelloDescription("Manuell geschriebene Szene fuer das Mockup"), false);

  const description = buildMockupTrelloDescription({
    requestId: "REQ-123",
    customerCompany: "Campus Lounge",
    requestDescription: "Coffee Bar an einer Hochschule",
    color: "Pink",
  });

  assert.match(description, /\[\[NEONTRIP_MOCKUP_SETTING_V1\]\]/);
  assert.match(description, /#startprompt[\s\S]+#endprompt/);
  assert.match(description, /#startvideoprompt[\s\S]+#endvideoprompt/);
  assert.match(description, /Segmentquelle: ai/);
});

test("image and video prompts share context but stay separately optimized", () => {
  const context = buildMockupContext({
    manualSegment: "Restaurant",
    requestTitle: "Logo Schriftzug",
    color: "Rot",
    usage: "Wandbereich",
    backboard: "Acryl Rueckplatte",
    product: "LED Neon Flex Schild",
  });
  const imagePrompt = buildImageMockupPrompt(context);
  const videoPrompt = buildVideoMockupPrompt(context);

  assert.notEqual(imagePrompt, videoPrompt);
  assert.match(imagePrompt, /photorealistic premium image mockup/);
  assert.match(videoPrompt, /short premium product video/);
  assert.match(videoPrompt, /slow subtle camera movement/);
  for (const prompt of [imagePrompt, videoPrompt]) {
    assert.match(prompt, /Industry: Restaurant/);
    assert.match(prompt, /no extra text/);
    assert.match(prompt, /no distorted letters/);
    assert.match(prompt, /no visible cables/);
    assert.match(prompt, /no visible power supply/);
    assert.match(prompt, /no fake logo variations/);
  }
});

test("segment storage uses manual or ai source and maps to existing NT taxonomy", () => {
  assert.deepEqual(inferRequestSegmentForStorage({ manualSegment: "NT-15" }), {
    segment: "NT-15",
    sKategorie: "S3",
    source: "manual",
    confidence: 1,
  });

  assert.deepEqual(inferRequestSegmentForStorage({ customerEmail: "team@dental-city.de" }), {
    segment: "NT-13",
    sKategorie: "S4",
    source: "ai",
    confidence: 0.82,
  });
});

test("trello description uses stored ai segment from master request when available", () => {
  const description = buildMockupTrelloDescription({
    requestId: "REQ-AI-SEGMENT",
    customerCompany: "Nachtigallenhof",
    requestDescription: "Logo fuer hochwertige Hofanlage",
    storedSegment: "NT-14",
    storedSegmentSource: "request_segmenter",
    storedSegmentConfidence: 0.91,
  });

  assert.match(description, /Segment: Immobilienbuero/);
  assert.match(description, /Segmentquelle: ai/);
  assert.match(description, /Konfidenz: 0\.91/);
  assert.match(description, /#startprompt[\s\S]+Immobilienbuero[\s\S]+#endprompt/);
});

test("stored gastronomy segment is not rendered as restaurant without matching context", () => {
  const description = buildMockupTrelloDescription({
    requestId: "REQ-GASTRO",
    customerCompany: "Unklarer Betrieb GmbH",
    requestDescription: "Logo fuer den Empfangsbereich",
    storedSegment: "NT-2",
    storedSegmentSource: "request_segmenter",
    storedSegmentConfidence: 0.8,
  });

  assert.match(description, /Segment: Gastronomie/);
  assert.doesNotMatch(description, /Segment: Restaurant/);
});

test("clear spa and physiotherapy context override coarse ai gastronomy segment for trello description", () => {
  const spa = buildMockupTrelloDescription({
    requestId: "REQ-SPA",
    customerCompany: "Aurum Spa",
    requestDescription: "Leuchtschrift fuer hochwertigen Wellness- und Massage-Empfang",
    storedSegment: "NT-2",
    storedSegmentSource: "request_segmenter",
    storedSegmentConfidence: 0.81,
  });
  assert.match(spa, /Segment: Spa \/ Wellness/);
  assert.match(spa, /Spa \/ Wellness - ruhiger hochwertiger Empfangs- oder Behandlungsbereich/);
  assert.doesNotMatch(spa, /Segment: Restaurant/);

  const physio = buildMockupTrelloDescription({
    requestId: "REQ-PHYSIO",
    customerCompany: "Therapiezentrum Am Park",
    requestDescription: "Logo fuer eine Physiotherapiepraxis",
    storedSegment: "NT-2",
    storedSegmentSource: "request_segmenter",
    storedSegmentConfidence: 0.79,
  });
  assert.match(physio, /Segment: Physiotherapiepraxis/);
  assert.match(physio, /Physiotherapiepraxis - moderner Empfangs- oder Therapiebereich/);
  assert.doesNotMatch(physio, /Segment: Restaurant/);
});

test("manual stored segment still wins over spa keyword context", () => {
  const segment = resolveMockupSegment({
    requestDescription: "Spa und Wellness Empfang",
    storedSegment: "NT-2",
    storedSegmentSource: "manual_ops_portal",
    storedSegmentConfidence: 1,
  });

  assert.equal(segment.segment, "Gastronomie");
  assert.equal(segment.source, "manual");
  assert.equal(segment.ntSegment, "NT-2");
});
