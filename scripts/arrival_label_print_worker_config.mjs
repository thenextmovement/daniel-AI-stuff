export function printDevice(value = "daniel") {
  if (value !== "daniel" && value !== "rahim") throw new Error("NEONTRIP_PRINT_DEVICE muss daniel oder rahim sein.");
  return value;
}

export function printWorkerId(device, kind) {
  printDevice(device);
  if (kind !== "label" && kind !== "delivery_note") throw new Error("Unbekannte Druckauftragsart.");
  const queue = kind === "label" ? "label-a6" : "delivery-note-a4";
  return device === "rahim" ? `rahims-mac-arrival-${queue}-fallback-01` : `daniels-mac-arrival-${queue}-01`;
}

export function configuredPrintDevice(explicit, installedDevices) {
  if (explicit !== undefined) return printDevice(explicit);
  const devices = [...new Set(installedDevices.map((device) => printDevice(device)))];
  if (devices.length > 1) throw new Error("Installierte Druckdienste haben widerspruechliche Geraetezuordnungen.");
  return devices[0] || "daniel";
}
