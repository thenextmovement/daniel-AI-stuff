import { CUSTOMER_SEGMENT_OPTIONS, getCustomerSegmentOption } from "./customer-segments";

export type MockupSegmentSource = "manual" | "ai" | "fallback";

export type MockupSegmentResult = {
  segment: string;
  source: MockupSegmentSource;
  confidence: number;
  reasonCodes: string[];
  ntSegment: string | null;
};

export type MockupContextInput = {
  customerCompany?: string | null;
  customerEmail?: string | null;
  requestTitle?: string | null;
  requestDescription?: string | null;
  product?: string | null;
  size?: string | null;
  color?: string | null;
  usage?: string | null;
  backboard?: string | null;
  customerType?: string | null;
  manualSegment?: string | null;
  storedSegment?: string | null;
  storedSegmentSource?: string | null;
  storedSegmentConfidence?: number | string | null;
};

export type MockupContext = MockupSegmentResult & {
  setting: string;
  usage: string;
  lightColor: string;
  backboard: string;
  productType: string;
  signContext: string;
};

export type MockupSegmentStorage = {
  segment: string | null;
  sKategorie: string | null;
  source: MockupSegmentSource;
  confidence: number;
};

const autoDescriptionMarker = "[[NEONTRIP_MOCKUP_SETTING_V1]]";
const genericBlockedValues = new Set([
  "kleines unternehmen",
  "firma",
  "business",
  "unternehmen",
  "kunde",
  "gewerbe",
  "sonstiges",
  "allgemein",
  "unbekannt",
  "unknown",
]);

const personalEmailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "freenet.de",
  "t-online.de",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.de",
  "yahoo.com",
  "yahoo.de",
  "icloud.com",
  "mail.de",
]);

type SegmentRule = {
  segment: string;
  ntSegment: string | null;
  keywords: RegExp[];
  setting: string;
};

const segmentRules: SegmentRule[] = [
  {
    segment: "Cafe / Coffee Shop",
    ntSegment: "NT-2",
    keywords: [/\bcafe\b/i, /\bcoffee\b/i, /kaffee/i, /roesterei/i, /barista/i],
    setting: "Cafe / Coffee Shop - moderner Tresenbereich, warme Beleuchtung, hochwertiges Lifestyle-/Gastro-Setting fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Restaurant",
    ntSegment: "NT-2",
    keywords: [/restaurant/i, /gastronomie/i, /bistro/i, /food/i, /catering/i],
    setting: "Restaurant / Gastronomie - hochwertiger Innenraum, Wandbereich oder Empfangsbereich, warmes Ambiente, realistisches Setting fuer Neon-Mockup.",
  },
  {
    segment: "Bar / Club",
    ntSegment: "NT-2",
    keywords: [/\bbar\b/i, /\bclub\b/i, /lounge/i, /nightlife/i, /cocktail/i],
    setting: "Bar / Club - dunklere Premium-Wand, stimmungsvolle Beleuchtung, hochwertiges Nachtleben-/Gastro-Setting fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Hotel",
    ntSegment: "NT-2",
    keywords: [/hotel/i, /hostel/i, /rezeption/i, /lobby/i],
    setting: "Hotel - moderner Lobby- oder Empfangsbereich, hochwertige Materialien, ruhiges Premium-Ambiente fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Arztpraxis",
    ntSegment: "NT-13",
    keywords: [/arzt/i, /medical/i, /clinic/i, /klinik/i, /praxis/i],
    setting: "Arztpraxis - moderner Empfangsbereich, klare helle Architektur, serioeses und hochwertiges Praxisumfeld fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Zahnarztpraxis",
    ntSegment: "NT-13",
    keywords: [/zahnarzt/i, /dental/i, /kiefer/i],
    setting: "Zahnarztpraxis - moderner Praxisempfang, cleanes helles Interior, hochwertiges medizinisches Umfeld fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Universitaet",
    ntSegment: "NT-10",
    keywords: [/universitaet/i, /\buni\b/i, /hochschule/i, /campus/i],
    setting: "Universitaet / Bildungseinrichtung - moderner Campus- oder Empfangsbereich, klare Architektur, serioeses institutionelles Umfeld.",
  },
  {
    segment: "Schule",
    ntSegment: "NT-10",
    keywords: [/schule/i, /academy/i, /akademie/i, /bildung/i],
    setting: "Schule / Bildungseinrichtung - moderner Eingangs- oder Gemeinschaftsbereich, klare freundliche Architektur, serioeses Bildungsumfeld.",
  },
  {
    segment: "Maschinenbau",
    ntSegment: "NT-9",
    keywords: [/maschinenbau/i, /industrial/i, /industrie/i, /produktion/i, /engineering/i, /technik/i],
    setting: "Maschinenbauunternehmen - industrielle Halle oder moderner Empfangsbereich, technisches B2B-Umfeld, cleanes Corporate-Setting.",
  },
  {
    segment: "Werkstatt",
    ntSegment: "NT-9",
    keywords: [/werkstatt/i, /garage/i, /handwerk/i],
    setting: "Werkstatt - sauberer moderner Arbeitsbereich, robuste Wandflaeche, hochwertiges handwerkliches Umfeld fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Autohaus",
    ntSegment: "NT-9",
    keywords: [/autohaus/i, /automotive/i, /fahrzeug/i, /car/i],
    setting: "Autohaus - moderner Showroom mit klarer Wand- oder Empfangsflaeche, hochwertiges Automotive-Umfeld fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Friseur",
    ntSegment: "NT-12",
    keywords: [/friseur/i, /hair/i, /barber/i],
    setting: "Friseur - moderner Salonbereich mit Spiegel-/Wandzone, hochwertiges Beauty-Interior, warmes Licht fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Beauty Salon",
    ntSegment: "NT-12",
    keywords: [/beauty/i, /kosmetik/i, /nail/i, /lashes/i, /brow/i, /tattoo/i],
    setting: "Beauty Salon - hochwertiger Salon- oder Empfangsbereich, warme Akzentbeleuchtung, stilvolles Beauty-Setting fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Fitnessstudio",
    ntSegment: "NT-15",
    keywords: [/fitness/i, /\bgym\b/i, /crossfit/i, /yoga/i, /training/i],
    setting: "Fitnessstudio - moderner Trainingsbereich, dunkle Wand, sportliches Premium-Ambiente, realistischer Kontext fuer Leuchtschild-Mockup.",
  },
  {
    segment: "Einzelhandel",
    ntSegment: "NT-18",
    keywords: [/retail/i, /einzelhandel/i, /boutique/i, /shop/i, /store/i, /laden/i],
    setting: "Einzelhandel - hochwertiger Verkaufsraum oder Schaufensterbereich, klare Produktpraesentation, realistisches Retail-Setting fuer Neon-Mockup.",
  },
  {
    segment: "Messebauer",
    ntSegment: "NT-3",
    keywords: [/messebau/i, /messestand/i, /\bexpo\b/i, /standbau/i],
    setting: "Messebauer - hochwertige Messewand oder Booth-Rueckwand, cleanes Event-Setting, professionelle Beleuchtung fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Eventagentur",
    ntSegment: "NT-3",
    keywords: [/eventagentur/i, /event/i, /veranstaltung/i, /festival/i],
    setting: "Eventagentur - hochwertiger Event-Backdrop oder Empfangsbereich, professionelle Lichtstimmung, realistisches Marken-/Event-Setting.",
  },
  {
    segment: "Immobilienbuero",
    ntSegment: "NT-14",
    keywords: [/immobilien/i, /makler/i, /real estate/i],
    setting: "Immobilienbuero - moderner Empfangs- oder Beratungsbereich, cleanes Corporate-Interior, serioeses Premium-Umfeld.",
  },
  {
    segment: "Kanzlei",
    ntSegment: "NT-13",
    keywords: [/kanzlei/i, /anwalt/i, /steuer/i, /notar/i, /law/i],
    setting: "Kanzlei - moderner Empfangs- oder Besprechungsbereich, hochwertige Materialien, serioeses professionelles Umfeld.",
  },
  {
    segment: "Buero",
    ntSegment: "NT-9",
    keywords: [/office/i, /buero/i, /agentur/i, /corporate/i],
    setting: "Buero - moderner Empfangs- oder Meetingbereich, cleanes Corporate-Setting, hochwertige Wandflaeche fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Showroom",
    ntSegment: "NT-18",
    keywords: [/showroom/i, /ausstellung/i],
    setting: "Showroom - moderne Praesentationsflaeche, hochwertige Wand oder Produktumfeld, cleanes Premium-Setting fuer realistisches Neon-Mockup.",
  },
  {
    segment: "Ladenlokal",
    ntSegment: "NT-18",
    keywords: [/ladenlokal/i, /geschaeft/i, /verkaufsraum/i],
    setting: "Ladenlokal - moderner Verkaufs- oder Empfangsbereich, hochwertige Wandflaeche, realistisches lokales Retail-Setting fuer Neon-Mockup.",
  },
];

function textValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: unknown) {
  return textValue(value).toLowerCase();
}

function emailDomain(value: unknown) {
  const email = normalizeKey(value);
  const domain = email.split("@")[1] || "";
  return domain.replace(/^www\./, "");
}

function isGenericSegment(value: unknown) {
  const normalized = normalizeKey(value);
  if (!normalized) return true;
  return genericBlockedValues.has(normalized);
}

function segmentRuleByName(value: unknown) {
  const normalized = normalizeKey(value);
  return segmentRules.find((rule) => normalizeKey(rule.segment) === normalized) || null;
}

function settingForSegment(segment: string) {
  const rule = segmentRuleByName(segment);
  if (rule) return rule.setting;
  const nt = getCustomerSegmentOption(segment);
  if (nt?.segment === "NT-2") return segmentRules.find((rule) => rule.segment === "Restaurant")?.setting;
  if (nt?.segment === "NT-3") return segmentRules.find((rule) => rule.segment === "Eventagentur")?.setting;
  if (nt?.segment === "NT-13") return segmentRules.find((rule) => rule.segment === "Arztpraxis")?.setting;
  if (nt?.segment === "NT-15") return segmentRules.find((rule) => rule.segment === "Fitnessstudio")?.setting;
  if (nt?.segment === "NT-14") return segmentRules.find((rule) => rule.segment === "Immobilienbuero")?.setting;
  if (nt?.segment === "NT-18") return segmentRules.find((rule) => rule.segment === "Showroom")?.setting;
  if (nt?.segment === "NT-9") return segmentRules.find((rule) => rule.segment === "Buero")?.setting;
  if (nt?.segment === "NT-10") return segmentRules.find((rule) => rule.segment === "Universitaet")?.setting;
  if (nt?.segment === "NT-12") return segmentRules.find((rule) => rule.segment === "Beauty Salon")?.setting;
  return null;
}

function displaySegment(value: string) {
  const nt = getCustomerSegmentOption(value);
  if (!nt) return value;
  if (nt.segment === "NT-2") return "Restaurant";
  if (nt.segment === "NT-3") return "Eventagentur";
  if (nt.segment === "NT-13") return "Arztpraxis";
  if (nt.segment === "NT-15") return "Fitnessstudio";
  if (nt.segment === "NT-14") return "Immobilienbuero";
  if (nt.segment === "NT-18") return "Showroom";
  if (nt.segment === "NT-9") return "Buero";
  if (nt.segment === "NT-10") return "Universitaet";
  if (nt.segment === "NT-12") return "Beauty Salon";
  return nt.label;
}

function findRule(input: MockupContextInput) {
  const domain = emailDomain(input.customerEmail);
  const domainText = domain && !personalEmailDomains.has(domain) ? domain.replace(/\.[a-z]{2,}$/, "").replace(/[-_.]/g, " ") : "";
  const haystack = [
    input.customerCompany,
    input.requestTitle,
    input.requestDescription,
    input.product,
    input.customerType,
    input.usage,
    domainText,
  ].map(normalizeKey).join(" ");

  return segmentRules.find((rule) => rule.keywords.some((keyword) => keyword.test(haystack))) || null;
}

function segmentSourceFromStored(value: unknown): MockupSegmentSource {
  const source = normalizeKey(value);
  if (source.includes("manual")) return "manual";
  if (source.includes("fallback")) return "fallback";
  return "ai";
}

function confidenceFromStored(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export function resolveMockupSegment(input: MockupContextInput): MockupSegmentResult {
  const manual = textValue(input.manualSegment);
  if (manual && !isGenericSegment(manual)) {
    const manualRule = segmentRuleByName(manual);
    const manualNt = getCustomerSegmentOption(manual);
    return {
      segment: manualRule?.segment || displaySegment(manual),
      source: "manual",
      confidence: 1,
      reasonCodes: ["manual_segment"],
      ntSegment: manualRule?.ntSegment || manualNt?.segment || null,
    };
  }

  const stored = textValue(input.storedSegment);
  if (stored && !isGenericSegment(stored)) {
    const storedRule = segmentRuleByName(stored);
    const storedNt = getCustomerSegmentOption(stored);
    const source = segmentSourceFromStored(input.storedSegmentSource);
    if (source !== "fallback") {
      return {
        segment: storedRule?.segment || displaySegment(stored),
        source,
        confidence: confidenceFromStored(input.storedSegmentConfidence, source === "manual" ? 1 : 0.82),
        reasonCodes: ["stored_request_segment"],
        ntSegment: storedRule?.ntSegment || storedNt?.segment || null,
      };
    }
  }

  const rule = findRule(input);
  if (rule) {
    return {
      segment: rule.segment,
      source: "ai",
      confidence: 0.82,
      reasonCodes: ["keyword_context_match"],
      ntSegment: rule.ntSegment,
    };
  }

  return {
    segment: "Showroom",
    source: "fallback",
    confidence: 0.4,
    reasonCodes: ["neutral_visual_fallback"],
    ntSegment: null,
  };
}

export function buildMockupContext(input: MockupContextInput): MockupContext {
  const segment = resolveMockupSegment(input);
  const setting = settingForSegment(segment.segment) || "Modernes Ladenlokal / Showroom - hochwertige Wandflaeche, klares Licht, realistisches neutrales Setting fuer Neon-Mockup.";
  const usage = textValue(input.usage) || "Innenbereich";
  const lightColor = textValue(input.color) || "Leuchtfarbe laut Kundenanfrage";
  const backboard = textValue(input.backboard) || "Rueckplatte laut Angebot";
  const productType = textValue(input.product) || "LED-Neonschild";
  const signContext = textValue(input.requestTitle) || textValue(input.customerCompany) || "kundenspezifisches Schild";

  return {
    ...segment,
    setting,
    usage,
    lightColor,
    backboard,
    productType,
    signContext,
  };
}

export function canAutoUpdateTrelloDescription(existingDescription: string | null | undefined) {
  const existing = String(existingDescription || "").trim();
  return !existing || existing.includes(autoDescriptionMarker);
}

export function buildImageMockupPrompt(context: MockupContext) {
  return [
    "Create one photorealistic premium image mockup of the provided LED neon sign.",
    `Sign/logo context: ${context.signContext}.`,
    `Industry: ${context.segment}.`,
    `Scene setting: ${context.setting}`,
    `Installation/use: ${context.usage}.`,
    `Light color: ${context.lightColor}.`,
    `Backboard: ${context.backboard}.`,
    `Product type: ${context.productType}.`,
    "Use a realistic wall or mounting surface, high-quality lighting, natural shadows, realistic glow and reflections.",
    "Keep the sign as the clear focus. Preserve the exact sign artwork, logo proportions, text, symbols and layout.",
    "Negative rules: no extra text, no random words, no distorted letters, no unreadable sign, no visible cables, no visible power supply, no fake logo variations, no messy background, no cheap stock photo look, no collage, no multiple scenes.",
  ].join("\n");
}

export function buildVideoMockupPrompt(context: MockupContext) {
  return [
    "Create a short premium product video based on the provided neon sign mockup.",
    `Industry: ${context.segment}.`,
    `Scene setting: ${context.setting}`,
    "Use a clean reveal with a slow subtle camera movement toward the sign.",
    "Animate only the light turning on, realistic glow, reflections and slight depth. Keep the sign in focus.",
    "Preserve the exact sign artwork, logo, text, symbols, proportions and layout throughout the video.",
    "Negative rules: no unnecessary effects, no extra text, no random words, no distorted letters, no unreadable sign, no visible cables, no visible power supply, no fake logo variations, no logo morphing, no text chaos, no faces or characters, no audio.",
  ].join("\n");
}

export function buildMockupTrelloDescription(input: MockupContextInput & { requestId: string }) {
  const context = buildMockupContext(input);
  const imagePrompt = buildImageMockupPrompt(context);
  const videoPrompt = buildVideoMockupPrompt(context);
  const lines = [
    autoDescriptionMarker,
    "Mockup-Setting (automatisch):",
    context.setting,
    "",
    `Segment: ${context.segment}`,
    `Segmentquelle: ${context.source}`,
    `Konfidenz: ${context.confidence}`,
    `Einsatzort: ${context.usage}`,
    `Leuchtfarbe: ${context.lightColor}`,
    `Rueckplatte: ${context.backboard}`,
    `Produktart: ${context.productType}`,
    "",
    "#startprompt",
    imagePrompt,
    "#endprompt",
    "",
    "#startvideoprompt",
    videoPrompt,
    "#endvideoprompt",
    "",
    "---",
    `Request-ID: ${input.requestId}`,
    `Kontaktkontext: ${textValue(input.customerCompany) || "-"}`,
  ];
  return lines.join("\n");
}

export function inferRequestSegmentForStorage(input: MockupContextInput): MockupSegmentStorage {
  const segment = resolveMockupSegment(input);
  const option = segment.ntSegment ? CUSTOMER_SEGMENT_OPTIONS.find((entry) => entry.segment === segment.ntSegment) : null;
  if (!option || segment.source === "fallback") {
    return {
      segment: null,
      sKategorie: null,
      source: "fallback",
      confidence: segment.confidence,
    };
  }
  return {
    segment: option.segment,
    sKategorie: option.defaultSKategorie,
    source: segment.source,
    confidence: segment.confidence,
  };
}

export const MOCKUP_TRELLO_DESCRIPTION_MARKER = autoDescriptionMarker;
