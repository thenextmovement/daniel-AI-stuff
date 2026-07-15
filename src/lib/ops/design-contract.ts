export const DESIGN_LIGHT_COLORS = [
  { key: "cool_white", label: "Kaltweiß", promptValue: "kaltweiß (6000 Kelvin)", swatch: "#dbeafe" },
  { key: "warm_white", label: "Warmweiß", promptValue: "warmweiß (3000 Kelvin)", swatch: "#ffe7a3" },
  { key: "green", label: "Grün", promptValue: "grün", swatch: "#22c55e" },
  { key: "blue", label: "Blau", promptValue: "blau", swatch: "#2563eb" },
  { key: "ice_blue", label: "Eisblau", promptValue: "eisblau", swatch: "#7dd3fc" },
  { key: "red", label: "Rot", promptValue: "rot", swatch: "#dc2626" },
  { key: "orange", label: "Orange", promptValue: "orange", swatch: "#f97316" },
  { key: "lemon_yellow", label: "Zitronengelb", promptValue: "zitronengelb", swatch: "#facc15" },
  { key: "gold_yellow", label: "Goldgelb", promptValue: "goldgelb", swatch: "#eab308" },
  { key: "pink", label: "Pink", promptValue: "pink", swatch: "#ec4899" },
  { key: "purple", label: "Lila", promptValue: "lila", swatch: "#9333ea" },
  { key: "turquoise", label: "Türkis", promptValue: "türkis", swatch: "#14b8a6" },
] as const;

export const DESIGN_PRODUCT_CHANGES = [
  { key: "frontlit_3d", label: "3D Frontlit" },
  { key: "backlit_3d", label: "3D Backlit" },
] as const;

export type DesignActionType = "manual_edit" | "light_color" | "product_change" | "mockup_mode";
export type DesignBatchActionType = Extract<DesignActionType, "light_color" | "product_change">;

function normalizedLabel(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/weiss/g, "weiß")
    .replace(/\s+/g, " ");
}

export function designLightColor(value: string | null | undefined) {
  const normalized = normalizedLabel(String(value || ""));
  if (!normalized) return null;
  return DESIGN_LIGHT_COLORS.find((color) =>
    [color.key, color.label, color.promptValue].some((candidate) => normalizedLabel(candidate) === normalized),
  ) || null;
}

export function designProductChange(value: string | null | undefined) {
  const normalized = normalizedLabel(String(value || ""));
  if (!normalized) return null;
  return DESIGN_PRODUCT_CHANGES.find((product) =>
    normalizedLabel(product.key) === normalized || normalizedLabel(product.label) === normalized,
  ) || null;
}

export function canonicalDesignActionValue(actionType: DesignBatchActionType, value: string) {
  return actionType === "light_color" ? designLightColor(value)?.label || null : designProductChange(value)?.label || null;
}

export function designActionPrompt(actionType: DesignBatchActionType, value: string) {
  if (actionType === "light_color") {
    const color = designLightColor(value);
    if (!color) return null;
    return [
      "Leuchtfarbe ändern:",
      `Ändere ausschließlich die sichtbare Leuchtfarbe des vorhandenen Schildes zu ${color.promptValue}.`,
      "Nutze ausschließlich das bereitgestellte KI-Mockup als Vorlage.",
      "Erhalte Text, Logo, Buchstabenform, Position, Perspektive, Hintergrund, Montage, Größe, Material, Bildausschnitt und Kamerawinkel unverändert.",
      "Keine neue Szene, kein neues Schild, keine neuen Wörter, keine zusätzlichen Logos und keine Änderungen außer der sichtbaren Licht-/LED-Farbe.",
    ].join("\n");
  }

  const product = designProductChange(value);
  if (!product) return null;
  const productInstruction = product.key === "frontlit_3d"
    ? "Wandle vorhandene Backlit-, Rückleuchter- oder unbeleuchtete Buchstaben in ein glaubwürdiges 3D-Frontlit-Schild mit nach vorne sichtbarer Lichtwirkung um."
    : "Wandle vorhandene Frontlit- oder unbeleuchtete Buchstaben in ein glaubwürdiges 3D-Backlit-Schild mit indirektem Halo-/Rückleucht-Effekt um.";
  return [
    "Produktart ändern:",
    `Ändere ausschließlich die Schildtechnik des vorhandenen Schildes zu ${product.label}.`,
    productInstruction,
    "Nutze ausschließlich das bereitgestellte KI-Mockup als Vorlage.",
    "Erhalte Text, Logo, Buchstabenform, Konturen, Größe, Position, Perspektive, Hintergrund, Wand, Montage, Bildausschnitt und Kamerawinkel unverändert.",
    "Keine neue Szene, kein neues Logo, keine neuen Wörter, keine andere Marke, keine Dekoration und keine Preis- oder Lieferangaben.",
  ].join("\n");
}

export function isJpegMimeType(value: string | null | undefined) {
  return /^image\/jpe?g(?:\s*;|$)/i.test(String(value || "").trim());
}

export function hasJpegMagicBytes(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff;
}
