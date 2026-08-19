import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackboardPromptBlock,
  buildImageMockupPrompt,
  buildMockupContext,
  buildMockupTrelloDescription,
  buildVideoMockupPrompt,
  canAutoUpdateTrelloDescription,
  MOCKUP_TRELLO_DESCRIPTION_MARKER,
  resolveMockupVisualContext,
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

  assert.equal(context.visualContext, "Cafe / Coffee Shop");
  assert.equal(context.source, "ai");
  assert.match(context.setting, /Tresenbereich/);
  assert.doesNotMatch(context.setting.toLowerCase(), /\b(kleines unternehmen|firma|business|kunde|gewerbe|sonstiges|allgemein|unbekannt)\b/);
});

test("manual visual context wins over inferred text context", () => {
  const context = resolveMockupVisualContext({
    manualSegment: "Fitnessstudio",
    requestDescription: "Restaurant mit warmer Gastro-Beleuchtung",
  });

  assert.equal(context.visualContext, "Fitnessstudio");
  assert.equal(context.source, "manual");
  assert.equal(context.confidence, 1);
  assert.equal("segment" in context, false);
  assert.equal("ntSegment" in context, false);
  assert.equal("sKategorie" in context, false);
});

test("unclear leads fall back to a visual showroom context without exposing storage authority", () => {
  const context = buildMockupContext({
    customerCompany: "Muster GmbH",
    customerEmail: "info@example.com",
    requestDescription: "Wir haetten gerne ein Schild.",
  });
  assert.equal(context.visualContext, "Showroom");
  assert.equal(context.source, "fallback");
  assert.match(context.setting, /Ladenlokal \/ Showroom|Praesentationsflaeche/);
  assert.equal("segment" in context, false);
  assert.equal("ntSegment" in context, false);
  assert.equal("sKategorie" in context, false);
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
  assert.match(description, /Kontextquelle: ai/);
  assert.doesNotMatch(description, /(?:^|\n)Segment:/);
  assert.doesNotMatch(description, /Segmentquelle:/);
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
    assert.match(prompt, /Visual context: Restaurant/);
    assert.match(prompt, /no extra text/);
    assert.match(prompt, /no distorted letters/);
    assert.match(prompt, /no visible cables/);
    assert.match(prompt, /no visible power supply/);
    assert.match(prompt, /no fake logo variations/);
  }
});

test("backboard prompt block explains feinschnitt as minimal acrylic bridges", () => {
  const context = buildMockupContext({
    manualSegment: "Restaurant",
    requestTitle: "Schriftzug Logo",
    color: "Warmweiss",
    usage: "Innenbereich",
    backboard: "Feinschnitt",
    product: "LED Neon Flex Schild",
  });
  const imagePrompt = buildImageMockupPrompt(context);
  const videoPrompt = buildVideoMockupPrompt(context);

  assert.match(context.backboardPromptBlock || "", /Feinschnitt/);
  assert.match(imagePrompt, /Do not show a large acrylic backing plate/);
  assert.match(imagePrompt, /minimal transparent acrylic directly behind the tubes/);
  assert.match(imagePrompt, /nearly invisible transparent acrylic bridges/);
  assert.match(videoPrompt, /Feinschnitt/);
  assert.doesNotMatch(imagePrompt, /rectangular acrylic backing/);
});

test("backboard prompt block distinguishes formzuschnitt from rectangular backing", () => {
  const contour = buildBackboardPromptBlock("Formzuschnitt");
  const rectangle = buildBackboardPromptBlock("Rechteckiger Zuschnitt");

  assert.match(contour || "", /contour-cut acrylic backing/);
  assert.match(contour || "", /outside contour of the logo/);
  assert.match(contour || "", /Do not turn this into a large rectangular plate/);
  assert.match(rectangle || "", /rectangular acrylic backing/);
  assert.match(rectangle || "", /one clear rectangular or square acrylic glass plate/);
  assert.match(rectangle || "", /Do not make the acrylic backing follow the logo contour/);
});

test("missing backboard does not invent a feinschnitt rule", () => {
  const context = buildMockupContext({
    requestDescription: "Logo fuer Empfang",
  });

  assert.equal(context.backboard, "Rueckplatte laut Angebot");
  assert.equal(context.backboardPromptBlock, null);
  assert.doesNotMatch(buildImageMockupPrompt(context), /Feinschnitt|minimal transparent acrylic directly behind the tubes/);
});

test("visual inference never exposes NT or S-category storage fields", () => {
  for (const context of [
    resolveMockupVisualContext({ manualSegment: "NT-15" }),
    resolveMockupVisualContext({ customerEmail: "team@dental-city.de" }),
  ]) {
    assert.equal("segment" in context, false);
    assert.equal("ntSegment" in context, false);
    assert.equal("sKategorie" in context, false);
  }
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

  assert.match(description, /Mockup-Kontext: Immobilienbuero/);
  assert.match(description, /Kontextquelle: ai/);
  assert.match(description, /Visuelle Sicherheit: 0\.91/);
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

  assert.match(description, /Mockup-Kontext: Gastronomie/);
  assert.doesNotMatch(description, /Mockup-Kontext: Restaurant/);
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
  assert.match(spa, /Mockup-Kontext: Spa \/ Wellness/);
  assert.match(spa, /Spa \/ Wellness - ruhiger hochwertiger Empfangs- oder Behandlungsbereich/);
  assert.doesNotMatch(spa, /Mockup-Kontext: Restaurant/);

  const physio = buildMockupTrelloDescription({
    requestId: "REQ-PHYSIO",
    customerCompany: "Therapiezentrum Am Park",
    requestDescription: "Logo fuer eine Physiotherapiepraxis",
    storedSegment: "NT-2",
    storedSegmentSource: "request_segmenter",
    storedSegmentConfidence: 0.79,
  });
  assert.match(physio, /Mockup-Kontext: Physiotherapiepraxis/);
  assert.match(physio, /Physiotherapiepraxis - moderner Empfangs- oder Therapiebereich/);
  assert.doesNotMatch(physio, /Mockup-Kontext: Restaurant/);
});

test("specific visual keywords override broad CX8 role defaults without creating segment authority", () => {
  const cases = [
    {
      input: { customerCompany: "Aurum Spa", requestDescription: "Wellness und Massage Empfang" },
      expected: "Spa / Wellness",
    },
    {
      input: { customerCompany: "Therapiezentrum Am Park", requestDescription: "Logo fuer eine Physiotherapiepraxis" },
      expected: "Physiotherapiepraxis",
    },
    {
      input: { customerCompany: "Glow Studio", requestDescription: "Kosmetik und Beauty Salon" },
      expected: "Beauty Salon",
    },
  ];

  for (const entry of cases) {
    const context = resolveMockupVisualContext({
      ...entry.input,
      storedSegment: "NT-9",
      storedSegmentSource: "request_segmenter",
      storedSegmentConfidence: 0.88,
      storedSegmentTaxonomyVersion: "nt_taxonomy_v2_20260819_cx8",
    });
    assert.equal(context.visualContext, entry.expected);
    assert.equal(context.source, "ai");
    assert.deepEqual(context.reasonCodes, ["keyword_visual_context_override"]);
    assert.equal("segment" in context, false);
    assert.equal("ntSegment" in context, false);
    assert.equal("sKategorie" in context, false);
  }
});

test("manual stored segment still wins over spa keyword context", () => {
  const context = resolveMockupVisualContext({
    requestDescription: "Spa und Wellness Empfang",
    storedSegment: "NT-2",
    storedSegmentSource: "manual_ops_portal",
    storedSegmentConfidence: 1,
  });

  assert.equal(context.visualContext, "Gastronomie");
  assert.equal(context.source, "manual");
  assert.equal("ntSegment" in context, false);
});
