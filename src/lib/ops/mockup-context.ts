import { formatCustomerSegmentLabel, getKnownCustomerSegmentOption } from "./customer-segments";

export type MockupContextSource = "manual" | "ai" | "fallback";

export type MockupVisualContextResult = {
  visualContext: string;
  source: MockupContextSource;
  confidence: number;
  reasonCodes: string[];
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
  storedSegmentTaxonomyVersion?: string | null;
};

export type MockupContext = MockupVisualContextResult & {
  setting: string;
  usage: string;
  lightColor: string;
  backboard: string;
  backboardPromptBlock: string | null;
  productType: string;
  signContext: string;
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

type VisualContextRule = {
  visualContext: string;
  keywords: RegExp[];
  setting: string;
};

const visualContextRules: VisualContextRule[] = [
  {
    visualContext: "Cafe / Coffee Shop",
    keywords: [/\bcafe\b/i, /\bcoffee\b/i, /kaffee/i, /roesterei/i, /barista/i],
    setting: "Cafe / Coffee Shop - moderner Tresenbereich, warme Beleuchtung, hochwertiges Lifestyle-/Gastro-Setting fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Restaurant",
    keywords: [/restaurant/i, /gastronomie/i, /bistro/i, /food/i, /catering/i],
    setting: "Restaurant / Gastronomie - hochwertiger Innenraum, Wandbereich oder Empfangsbereich, warmes Ambiente, realistisches Setting fuer Neon-Mockup.",
  },
  {
    visualContext: "Bar / Club",
    keywords: [/\bbar\b/i, /\bclub\b/i, /lounge/i, /nightlife/i, /cocktail/i],
    setting: "Bar / Club - dunklere Premium-Wand, stimmungsvolle Beleuchtung, hochwertiges Nachtleben-/Gastro-Setting fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Hotel",
    keywords: [/hotel/i, /hostel/i, /rezeption/i, /lobby/i],
    setting: "Hotel - moderner Lobby- oder Empfangsbereich, hochwertige Materialien, ruhiges Premium-Ambiente fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Physiotherapiepraxis",
    keywords: [/physio/i, /physiotherapie/i, /therapiezentrum/i, /rehabilitation/i, /\breha\b/i],
    setting: "Physiotherapiepraxis - moderner Empfangs- oder Therapiebereich, helles cleanes Praxisumfeld, hochwertig und vertrauenswuerdig fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Arztpraxis",
    keywords: [/arzt/i, /medical/i, /clinic/i, /klinik/i, /praxis/i],
    setting: "Arztpraxis - moderner Empfangsbereich, klare helle Architektur, serioeses und hochwertiges Praxisumfeld fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Zahnarztpraxis",
    keywords: [/zahnarzt/i, /dental/i, /kiefer/i],
    setting: "Zahnarztpraxis - moderner Praxisempfang, cleanes helles Interior, hochwertiges medizinisches Umfeld fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Spa / Wellness",
    keywords: [/\bspa\b/i, /wellness/i, /massage/i, /sauna/i, /beauty spa/i],
    setting: "Spa / Wellness - ruhiger hochwertiger Empfangs- oder Behandlungsbereich, warme Premium-Atmosphaere, cleanes entspannendes Interior fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Universitaet",
    keywords: [/universitaet/i, /\buni\b/i, /hochschule/i, /campus/i],
    setting: "Universitaet / Bildungseinrichtung - moderner Campus- oder Empfangsbereich, klare Architektur, serioeses institutionelles Umfeld.",
  },
  {
    visualContext: "Schule",
    keywords: [/schule/i, /academy/i, /akademie/i, /bildung/i],
    setting: "Schule / Bildungseinrichtung - moderner Eingangs- oder Gemeinschaftsbereich, klare freundliche Architektur, serioeses Bildungsumfeld.",
  },
  {
    visualContext: "Maschinenbau",
    keywords: [/maschinenbau/i, /industrial/i, /industrie/i, /produktion/i, /engineering/i, /technik/i],
    setting: "Maschinenbauunternehmen - industrielle Halle oder moderner Empfangsbereich, technisches B2B-Umfeld, cleanes Corporate-Setting.",
  },
  {
    visualContext: "Werkstatt",
    keywords: [/werkstatt/i, /garage/i, /handwerk/i],
    setting: "Werkstatt - sauberer moderner Arbeitsbereich, robuste Wandflaeche, hochwertiges handwerkliches Umfeld fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Autohaus",
    keywords: [/autohaus/i, /automotive/i, /fahrzeug/i, /car/i],
    setting: "Autohaus - moderner Showroom mit klarer Wand- oder Empfangsflaeche, hochwertiges Automotive-Umfeld fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Friseur",
    keywords: [/friseur/i, /hair/i, /barber/i],
    setting: "Friseur - moderner Salonbereich mit Spiegel-/Wandzone, hochwertiges Beauty-Interior, warmes Licht fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Beauty Salon",
    keywords: [/beauty/i, /kosmetik/i, /nail/i, /lashes/i, /brow/i, /tattoo/i],
    setting: "Beauty Salon - hochwertiger Salon- oder Empfangsbereich, warme Akzentbeleuchtung, stilvolles Beauty-Setting fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Fitnessstudio",
    keywords: [/fitness/i, /\bgym\b/i, /crossfit/i, /yoga/i, /training/i],
    setting: "Fitnessstudio - moderner Trainingsbereich, dunkle Wand, sportliches Premium-Ambiente, realistischer Kontext fuer Leuchtschild-Mockup.",
  },
  {
    visualContext: "Einzelhandel",
    keywords: [/retail/i, /einzelhandel/i, /boutique/i, /shop/i, /store/i, /laden/i],
    setting: "Einzelhandel - hochwertiger Verkaufsraum oder Schaufensterbereich, klare Produktpraesentation, realistisches Retail-Setting fuer Neon-Mockup.",
  },
  {
    visualContext: "Messebauer",
    keywords: [/messebau/i, /messestand/i, /\bexpo\b/i, /standbau/i],
    setting: "Messebauer - hochwertige Messewand oder Booth-Rueckwand, cleanes Event-Setting, professionelle Beleuchtung fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Eventagentur",
    keywords: [/eventagentur/i, /event/i, /veranstaltung/i, /festival/i],
    setting: "Eventagentur - hochwertiger Event-Backdrop oder Empfangsbereich, professionelle Lichtstimmung, realistisches Marken-/Event-Setting.",
  },
  {
    visualContext: "Immobilienbuero",
    keywords: [/immobilien/i, /makler/i, /real estate/i],
    setting: "Immobilienbuero - moderner Empfangs- oder Beratungsbereich, cleanes Corporate-Interior, serioeses Premium-Umfeld.",
  },
  {
    visualContext: "Kanzlei",
    keywords: [/kanzlei/i, /anwalt/i, /steuer/i, /notar/i, /law/i],
    setting: "Kanzlei - moderner Empfangs- oder Besprechungsbereich, hochwertige Materialien, serioeses professionelles Umfeld.",
  },
  {
    visualContext: "Buero",
    keywords: [/office/i, /buero/i, /agentur/i, /corporate/i],
    setting: "Buero - moderner Empfangs- oder Meetingbereich, cleanes Corporate-Setting, hochwertige Wandflaeche fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Showroom",
    keywords: [/showroom/i, /ausstellung/i],
    setting: "Showroom - moderne Praesentationsflaeche, hochwertige Wand oder Produktumfeld, cleanes Premium-Setting fuer realistisches Neon-Mockup.",
  },
  {
    visualContext: "Ladenlokal",
    keywords: [/ladenlokal/i, /geschaeft/i, /verkaufsraum/i],
    setting: "Ladenlokal - moderner Verkaufs- oder Empfangsbereich, hochwertige Wandflaeche, realistisches lokales Retail-Setting fuer Neon-Mockup.",
  },
];

function textValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeBackboardKey(value: unknown) {
  return textValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

export function buildBackboardPromptBlock(backboardValue: string | null | undefined) {
  const normalized = normalizeBackboardKey(backboardValue);
  if (!normalized) return null;

  if (/feinschnitt|fine\s*cut|minimal\s*(?:acryl|acrylic)/i.test(normalized)) {
    return [
      "Backboard construction rule: Feinschnitt.",
      "Do not show a large acrylic backing plate.",
      "Do not show a contour-cut acrylic board around the full logo.",
      "The neon tubes should have only minimal transparent acrylic directly behind the tubes.",
      "If separate letters or logo parts need support, connect them with very thin, nearly invisible transparent acrylic bridges.",
      "The result must still be one manufacturable sign, but with as little visible acrylic as technically possible.",
    ].join("\n");
  }

  if (/rechteck|rectang|square|quadratisch|viereck/i.test(normalized)) {
    return [
      "Backboard construction rule: rectangular acrylic backing.",
      "Show the complete design mounted on one clear rectangular or square acrylic glass plate.",
      "Use straight clean edges and proportions that fit the design.",
      "Do not make the acrylic backing follow the logo contour.",
    ].join("\n");
  }

  if (/formzuschnitt|form\s*zuschnitt|kontur|contour|cut\s*to\s*shape|shape\s*cut|cut-to-shape/i.test(normalized)) {
    return [
      "Backboard construction rule: Formzuschnitt / contour-cut acrylic backing.",
      "Show a transparent acrylic backing plate that roughly follows the outside contour of the logo.",
      "The contour-cut acrylic may be visible, but it must look clean, premium and intentionally shaped.",
      "Do not turn this into a large rectangular plate unless the request explicitly says rectangular backing.",
    ].join("\n");
  }

  return null;
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

function visualContextRuleByName(value: unknown) {
  const normalized = normalizeKey(value);
  return visualContextRules.find((rule) => normalizeKey(rule.visualContext) === normalized) || null;
}

function settingForVisualContext(visualContext: string) {
  const rule = visualContextRuleByName(visualContext);
  if (rule) return rule.setting;
  const nt = getKnownCustomerSegmentOption(visualContext);
  if (nt?.segment === "NT-2") return "Gastronomie - passender hochwertiger Restaurant-, Cafe-, Bar- oder Hotelbereich je nach Kundenkontext, warmes Ambiente, realistisches Setting fuer Neon-Mockup.";
  if (nt?.segment === "NT-3") return visualContextRules.find((entry) => entry.visualContext === "Eventagentur")?.setting;
  if (nt?.segment === "NT-13") return visualContextRules.find((entry) => entry.visualContext === "Arztpraxis")?.setting;
  if (nt?.segment === "NT-15") return visualContextRules.find((entry) => entry.visualContext === "Fitnessstudio")?.setting;
  if (nt?.segment === "NT-14") return visualContextRules.find((entry) => entry.visualContext === "Immobilienbuero")?.setting;
  if (nt?.segment === "NT-18") return visualContextRules.find((entry) => entry.visualContext === "Showroom")?.setting;
  if (nt?.segment === "NT-9") return visualContextRules.find((entry) => entry.visualContext === "Buero")?.setting;
  if (nt?.segment === "NT-10") return visualContextRules.find((entry) => entry.visualContext === "Universitaet")?.setting;
  if (nt?.segment === "NT-12") return visualContextRules.find((entry) => entry.visualContext === "Beauty Salon")?.setting;
  return null;
}

function displayVisualContext(value: string, taxonomyVersion?: string | null) {
  const nt = getKnownCustomerSegmentOption(value);
  if (!nt) return value;
  if (nt.segment === "NT-2") return "Gastronomie";
  if (nt.segment === "NT-3") return "Eventagentur";
  if (nt.segment === "NT-13") return "Arztpraxis";
  if (nt.segment === "NT-15") return "Fitnessstudio";
  if (nt.segment === "NT-14") return "Immobilienbuero";
  if (nt.segment === "NT-18") return "Showroom";
  if (nt.segment === "NT-9") return "Buero";
  if (nt.segment === "NT-10") return "Universitaet";
  if (nt.segment === "NT-12") return "Beauty Salon";
  return formatCustomerSegmentLabel(nt.segment, taxonomyVersion) || nt.segment;
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

  return visualContextRules.find((rule) => rule.keywords.some((keyword) => keyword.test(haystack))) || null;
}

function contextSourceFromStored(value: unknown): MockupContextSource {
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

export function resolveMockupVisualContext(input: MockupContextInput): MockupVisualContextResult {
  const manual = textValue(input.manualSegment);
  if (manual && !isGenericSegment(manual)) {
    const manualRule = visualContextRuleByName(manual);
    return {
      visualContext: manualRule?.visualContext || displayVisualContext(manual),
      source: "manual",
      confidence: 1,
      reasonCodes: ["manual_visual_context"],
    };
  }

  const stored = textValue(input.storedSegment);
  if (stored && !isGenericSegment(stored)) {
    const storedRule = visualContextRuleByName(stored);
    const source = contextSourceFromStored(input.storedSegmentSource);
    if (source !== "fallback") {
      const contextualRule = source !== "manual" ? findRule(input) : null;
      if (contextualRule) {
        return {
          visualContext: contextualRule.visualContext,
          source: "ai",
          confidence: confidenceFromStored(input.storedSegmentConfidence, 0.82),
          reasonCodes: ["keyword_visual_context_override"],
        };
      }
      return {
        visualContext: storedRule?.visualContext || displayVisualContext(stored, input.storedSegmentTaxonomyVersion),
        source,
        confidence: confidenceFromStored(input.storedSegmentConfidence, source === "manual" ? 1 : 0.82),
        reasonCodes: ["stored_request_segment_visual_default"],
      };
    }
  }

  const rule = findRule(input);
  if (rule) {
    return {
      visualContext: rule.visualContext,
      source: "ai",
      confidence: 0.82,
      reasonCodes: ["keyword_visual_context_match"],
    };
  }

  return {
    visualContext: "Showroom",
    source: "fallback",
    confidence: 0.4,
    reasonCodes: ["neutral_visual_fallback"],
  };
}

export function buildMockupContext(input: MockupContextInput): MockupContext {
  const visualContext = resolveMockupVisualContext(input);
  const setting = settingForVisualContext(visualContext.visualContext) || "Modernes Ladenlokal / Showroom - hochwertige Wandflaeche, klares Licht, realistisches neutrales Setting fuer Neon-Mockup.";
  const usage = textValue(input.usage) || "Innenbereich";
  const lightColor = textValue(input.color) || "Leuchtfarbe laut Kundenanfrage";
  const backboard = textValue(input.backboard) || "Rueckplatte laut Angebot";
  const backboardPromptBlock = buildBackboardPromptBlock(backboard);
  const productType = textValue(input.product) || "LED-Neonschild";
  const signContext = textValue(input.requestTitle) || textValue(input.customerCompany) || "kundenspezifisches Schild";

  return {
    ...visualContext,
    setting,
    usage,
    lightColor,
    backboard,
    backboardPromptBlock,
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
    `Visual context: ${context.visualContext}.`,
    `Scene setting: ${context.setting}`,
    `Installation/use: ${context.usage}.`,
    `Light color: ${context.lightColor}.`,
    `Backboard: ${context.backboard}.`,
    context.backboardPromptBlock,
    `Product type: ${context.productType}.`,
    "Use a realistic wall or mounting surface, high-quality lighting, natural shadows, realistic glow and reflections.",
    "Keep the sign as the clear focus. Preserve the exact sign artwork, logo proportions, text, symbols and layout.",
    "Negative rules: no extra text, no random words, no distorted letters, no unreadable sign, no visible cables, no visible power supply, no fake logo variations, no messy background, no cheap stock photo look, no collage, no multiple scenes.",
  ].join("\n");
}

export function buildVideoMockupPrompt(context: MockupContext) {
  return [
    "Create a short premium product video based on the provided neon sign mockup.",
    `Visual context: ${context.visualContext}.`,
    `Scene setting: ${context.setting}`,
    context.backboardPromptBlock,
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
    `Mockup-Kontext: ${context.visualContext}`,
    `Kontextquelle: ${context.source}`,
    `Visuelle Sicherheit: ${context.confidence}`,
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

export const MOCKUP_TRELLO_DESCRIPTION_MARKER = autoDescriptionMarker;
