/** Only this explicitly approved add-on may create a second paid parcel. */
export const ACRYLIC_PARCEL_TEXT = "(Tischgerät)";
export type ArrivalParcelKind = "main" | "acrylic_table_device";

export function hasAcrylicTableDevice(items: Array<{ title: string; quantity: number }>) {
  return items.some(({ title, quantity }) => Number.isInteger(quantity) && quantity > 0
    && title.normalize("NFKC").toLocaleLowerCase("de-DE")
      .replace(/[-‐‑–—\s]+/g, " ").trim() === "acryl led tischgerät");
}

export function labelOverlayText(trackingNumber: string, parcelKind: ArrivalParcelKind = "main", parcelCount = 1) {
  if (!/^\d{10,40}$/.test(trackingNumber)) throw new Error("Ungueltige vollstaendige DHL-Sendungsnummer.");
  if (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 99) throw new Error("Ungueltige Paketanzahl.");
  if (parcelCount > 1 && parcelKind !== "main") throw new Error("Weitere Pakete bleiben manuell.");
  if (parcelKind === "acrylic_table_device") return `${trackingNumber.slice(-6)} ${ACRYLIC_PARCEL_TEXT}`;
  if (parcelKind !== "main") throw new Error("Unbekannter Pakettyp.");
  return trackingNumber.slice(-6) + (parcelCount > 1 ? ` Paket 1 von ${parcelCount}` : "");
}
