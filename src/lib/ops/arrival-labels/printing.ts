import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export type PrintJobResult = "dispatching" | "submitted" | "printed" | "retryable_error" | "uncertain";

export class PrintInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintInputError";
  }
}

export function formatOperationalError(error: unknown) {
  const message = error instanceof Error ? error.message : error ? String(error) : "unknown";
  let candidate: unknown = error;
  for (let depth = 0; depth < 3 && candidate && typeof candidate === "object"; depth += 1) {
    const code = String((candidate as { code?: unknown }).code || "");
    if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return `${message} (${code})`.slice(0, 500);
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return message.slice(0, 500);
}

export function validatePrintWorkerId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(value)) throw new PrintInputError("Ungueltige Print-Worker-ID.");
  return value;
}

export function validatePrinterKey(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new PrintInputError("Ungueltiger logischer Druckerschluessel.");
  return value;
}

export function validateCupsName(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new PrintInputError("Ungueltiger CUPS-Druckername.");
  return value;
}

export function validatePrintMedia(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new PrintInputError("Ungueltiges CUPS-Medium.");
  return value;
}

const APPROVED_LOCAL_PRINTER_MAPPINGS = {
  "shipping-a6": { cupsPrinter: "Brother_QL_1110NWB", media: "4x6" },
  "shipping-a4-delivery-note": { cupsPrinter: "HP_Color_LaserJet_Pro_MFP_3302", media: "A4" },
} as const;

export function validateApprovedArrivalPrinterMapping(input: { printerKey: string; cupsPrinter: string; media: string }) {
  const printerKey = validatePrinterKey(input.printerKey);
  const cupsPrinter = validateCupsName(input.cupsPrinter);
  const media = validatePrintMedia(input.media);
  const approved = APPROVED_LOCAL_PRINTER_MAPPINGS[printerKey as keyof typeof APPROVED_LOCAL_PRINTER_MAPPINGS];
  if (!approved || approved.cupsPrinter !== cupsPrinter || approved.media !== media) {
    throw new PrintInputError("Logischer Drucker, physische CUPS-Queue und Medium entsprechen nicht der freigegebenen Zuordnung.");
  }
  return { printerKey, cupsPrinter, media };
}

export async function readBoundedResponseBytes(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw new PrintInputError("Antwort ist groesser als erlaubt.");
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new PrintInputError("Antwort ist groesser als erlaubt.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedJson<T>(request: Request, maximumBytes = 4096): Promise<T> {
  const contentType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new PrintInputError("Content-Type muss application/json sein.");
  const response = new Response(request.body, { headers: request.headers });
  const bytes = await readBoundedResponseBytes(response, maximumBytes);
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as T;
  } catch {
    throw new PrintInputError("Ungueltiger JSON-Request.");
  }
}

export function assertPrintPdf(bytes: Uint8Array, expectedSha256: string) {
  if (bytes.byteLength < 100 || bytes.byteLength > 10 * 1024 * 1024) throw new Error("Druck-PDF hat eine ungueltige Groesse.");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Druckdatei ist kein PDF.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(expectedSha256) || sha256 !== expectedSha256) throw new Error("Druck-PDF-Pruefsumme stimmt nicht.");
  return sha256;
}

export function parseCupsJobId(output: string) {
  const normalized = output.replace(/[\u2010-\u2015\u2212]/g, "-");
  const matches = normalized.match(/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}-\d+/g) || [];
  const jobId = matches.at(-1) || null;
  if (!jobId) throw new Error("CUPS lieferte keine auswertbare Job-ID.");
  return jobId;
}

export function cupsSupportsMedia(output: string, media: string) {
  const pageSize = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("PageSize/") || line.startsWith("media/"));
  if (!pageSize) return false;
  const values = pageSize.slice(pageSize.indexOf(":") + 1)
    .trim()
    .split(/\s+/)
    .map((value) => value.replace(/^\*/, ""));
  return values.includes(media);
}

export type ProcessResult = { exitCode: number; stdout: string; stderr: string };
export type ProcessRunner = (command: string, args: string[], timeoutMs?: number) => Promise<ProcessResult>;

export const runBoundedProcess: ProcessRunner = (command, args, timeoutMs = 30_000) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  // CUPS lists completed jobs newest-first. Preserve the beginning so recent jobs
  // remain visible after the local history grows beyond the output limit.
  const append = (current: string, value: Buffer) => current.length >= 16_000
    ? current
    : `${current}${value.toString("utf8")}`.slice(0, 16_000);
  child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
  child.on("error", reject);
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(new Error(`${command} Zeitlimit ueberschritten.`));
  }, timeoutMs);
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({ exitCode: code ?? 1, stdout, stderr });
  });
});

export function createCupsPrinter(input: {
  cupsPrinter: string;
  media: string;
  runner?: ProcessRunner;
}) {
  const cupsPrinter = validateCupsName(input.cupsPrinter);
  const media = validatePrintMedia(input.media);
  const runner = input.runner || runBoundedProcess;
  return {
    async selfTest() {
      const [printer, options] = await Promise.all([
        runner("lpstat", ["-p", cupsPrinter]),
        runner("lpoptions", ["-p", cupsPrinter, "-l"]),
      ]);
      if (printer.exitCode !== 0 || options.exitCode !== 0) throw new Error("CUPS oder der konfigurierte Drucker ist nicht bereit.");
      if (!cupsSupportsMedia(options.stdout, media)) throw new Error("Der konfigurierte CUPS-Drucker bietet das freigegebene Medium nicht an.");
    },
    async submit(pdfPath: string) {
      const result = await runner("lp", ["-d", cupsPrinter, "-o", `media=${media}`, "-o", "sides=one-sided", pdfPath]);
      if (result.exitCode !== 0) throw new Error(`CUPS-Druckauftrag abgelehnt: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
      return parseCupsJobId(`${result.stdout}\n${result.stderr}`);
    },
    async isCompleted(cupsJobId: string) {
      const result = await runner("lpstat", ["-W", "completed", "-o", cupsPrinter]);
      if (result.exitCode !== 0) return false;
      return result.stdout.split(/\r?\n/).some((line) => line.trim().startsWith(`${cupsJobId} `) || line.trim() === cupsJobId);
    },
  };
}
