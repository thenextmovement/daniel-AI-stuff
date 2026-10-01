export const CHANNELS = ["ig", "fb", "linkedin", "pinterest", "gmb"] as const;
export type Channel = (typeof CHANNELS)[number];
export const LABELS: Record<Channel, string> = {
  ig: "Instagram",
  fb: "Facebook",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  gmb: "Google Business",
};
export const LIMITS: Record<Channel, number> = {
  ig: 2200,
  fb: 5000,
  linkedin: 3000,
  pinterest: 500,
  gmb: 1500,
};
export const FORMATS: Record<
  Channel,
  { key: string; width: number; height: number }
> = {
  ig: { key: "portrait", width: 1080, height: 1350 },
  fb: { key: "landscape", width: 1200, height: 900 },
  linkedin: { key: "landscape", width: 1200, height: 900 },
  pinterest: { key: "pin", width: 1000, height: 1500 },
  gmb: { key: "landscape", width: 1200, height: 900 },
};
export type Texts = Record<Channel, string> & { pinterestTitle: string };
export function validateTexts(value: unknown): Texts {
  if (!value || typeof value !== "object")
    throw new Error("Bitte alle Texte ausfüllen.");
  const texts = value as Texts;
  for (const key of [...CHANNELS, "pinterestTitle"] as const) {
    const s = texts[key];
    if (
      typeof s !== "string" ||
      !s.trim() ||
      s.length > (key === "pinterestTitle" ? 100 : LIMITS[key])
    )
      throw new Error("Text fehlt oder ist zu lang: " + key);
    if (key !== "ig" && /\p{Extended_Pictographic}/u.test(s))
      throw new Error("Bitte Symbole aus dem Text entfernen.");
    if (/hersteller|produktion|produzieren|manufacturer/i.test(s))
      throw new Error("Bitte NEONTRIP als Spezialisten beschreiben.");
    if (
      /(?:realisier|umgesetz|installier|geliefer|montier)\w*\s+(?:kunden|projekt|schild)|unser(?:e|en|em)?\s+(?:kunde|kundin)|für\s+unser(?:en|e)\s+kund/i.test(
        s,
      )
    )
      throw new Error(
        "Dieses Bild ist eine Designidee. Bitte keine realisierte Kundenreferenz behaupten.",
      );
    if (
      /\b(?:KI|AI)\b|künstliche\s+Intelligenz|Visualisier|Mockup|computergeneriert|generiertes\s+Bild/i.test(
        s,
      )
    )
      throw new Error("Bitte den Text direkt über das Schild formulieren.");
    if (key === "ig") {
      if (/https?:\/\//i.test(s))
        throw new Error("Bitte den Instagram-Text ohne URL formulieren.");
    } else if (key !== "pinterestTitle") {
      if (!s.includes("https://anfrage.neontrip.de"))
        throw new Error("Bitte den Anfragelink im Text behalten.");
      const urls = s.match(/https?:\/\/[^\s]+/g) || [];
      if (
        urls.some(
          (u) => !/^https:\/\/anfrage\.neontrip\.de\/?[.!?,]?$/i.test(u),
        )
      )
        throw new Error(
          "Bitte ausschließlich den NEONTRIP-Anfragelink verwenden.",
        );
    }
  }
  return Object.fromEntries(
    [...CHANNELS, "pinterestTitle"].map((k) => [
      k,
      texts[k as keyof Texts].trim(),
    ]),
  ) as Texts;
}
