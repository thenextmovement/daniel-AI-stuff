import { createHash } from "node:crypto";
import { readBoundedResponseBytes } from "./arrival-labels/printing";

export const SUPPLIER_FILE_BUCKET = "customer-documents";
export type SupplierFileBackup = {
  attachmentId: string; name: string; bucket: string; path: string;
  sha256: string; byteSize: number; contentType: string; verifiedAt: string;
};
function storageConfig() {
  const base = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!/^https:\/\//.test(base) || !key) throw new Error("Die vorhandene Supabase-Ablage ist nicht konfiguriert.");
  return { base, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}
export async function checkSupplierFileStorage(fetcher: typeof fetch = fetch) {
  const { base, headers } = storageConfig();
  const response = await fetcher(`${base}/storage/v1/bucket/${SUPPLIER_FILE_BUCKET}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Die bestehende Dateiablage ist nicht erreichbar (HTTP ${response.status}).`);
  const bucket = await response.json() as { id?: string; public?: boolean; allowed_mime_types?: string[] | null; file_size_limit?: number | null };
  if (bucket.id !== SUPPLIER_FILE_BUCKET || bucket.public !== false) throw new Error("Dateisicherungen benötigen die private Ablage customer-documents.");
  return bucket;
}
export async function readSupplierFileBackup(backup: SupplierFileBackup, fetcher: typeof fetch = fetch) {
  const { base, headers } = storageConfig();
  if (backup.bucket !== SUPPLIER_FILE_BUCKET || !/^neontrip\/sales\/[a-f0-9-]+\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-f0-9]{64}$/.test(backup.path)) throw new Error("Ungültiger Sicherungspfad.");
  const response = await fetcher(`${base}/storage/v1/object/authenticated/${backup.bucket}/${backup.path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Die Dateisicherung konnte nicht zurückgelesen werden.");
  const bytes = await readBoundedResponseBytes(response, 25 * 1024 * 1024);
  if (bytes.byteLength !== backup.byteSize || createHash("sha256").update(bytes).digest("hex") !== backup.sha256) throw new Error("Die Dateisicherung ist nicht bytegleich.");
  return bytes;
}
export async function backupSupplierFile(input: {
  saleId: string; cardId: string; attachmentId: string; name: string; contentType: string; bytes: Uint8Array;
}, fetcher: typeof fetch = fetch): Promise<SupplierFileBackup> {
  if (!/^[a-f0-9-]{36}$/i.test(input.saleId) || !/^[a-f0-9]{24}$/i.test(input.cardId) || !/^[a-f0-9]{24}$/i.test(input.attachmentId)) throw new Error("Ungültige Zuordnung für Dateisicherung.");
  const bucket = await checkSupplierFileStorage(fetcher);
  if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(input.contentType)) throw new Error("Dateityp ist in der privaten Ablage nicht erlaubt. Datei bleibt in Trello.");
  if (!input.bytes.byteLength || input.bytes.byteLength > Math.min(bucket.file_size_limit || Infinity, 25 * 1024 * 1024)) throw new Error("Datei überschreitet die erlaubte Sicherungsgröße.");
  const backup: SupplierFileBackup = {
    attachmentId: input.attachmentId, name: input.name, bucket: SUPPLIER_FILE_BUCKET,
    sha256: createHash("sha256").update(input.bytes).digest("hex"), byteSize: input.bytes.byteLength,
    contentType: input.contentType, path: "", verifiedAt: new Date().toISOString(),
  };
  backup.path = `neontrip/sales/${input.saleId}/${input.cardId}/${input.attachmentId}/${backup.sha256}`;
  const { base, headers } = storageConfig();
  const response = await fetcher(`${base}/storage/v1/object/${backup.bucket}/${backup.path}`, {
    method: "POST", headers: { ...headers, "Content-Type": backup.contentType, "x-upsert": "false" },
    body: Buffer.from(input.bytes), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && ![400, 409].includes(response.status)) throw new Error(`Dateisicherung fehlgeschlagen (HTTP ${response.status}).`);
  // Every successful upload AND every duplicate response is independently read and hashed.
  await readSupplierFileBackup(backup, fetcher);
  return backup;
}
