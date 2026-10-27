import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertPrintPdf,
  createCupsPrinter,
  cupsSupportsMedia,
  parseCupsJobId,
  readBoundedJson,
  readBoundedResponseBytes,
  runBoundedProcess,
  validateApprovedArrivalPrinterMapping,
  validateCupsName,
  validatePrinterKey,
  validatePrintWorkerId,
  type ProcessRunner,
} from "../../src/lib/ops/arrival-labels/printing";

test("print identifiers accept bounded allowlisted values and reject command injection", () => {
  assert.equal(validatePrintWorkerId("office-worker-01"), "office-worker-01");
  assert.equal(validatePrinterKey("shipping_a6"), "shipping_a6");
  assert.equal(validateCupsName("Zebra-ZD421"), "Zebra-ZD421");
  assert.throws(() => validateCupsName("printer; shutdown -h now"), /CUPS/);
  assert.throws(() => validatePrinterKey("../../printer"), /Druckerschluessel/);
});

test("local print worker accepts only the approved physical A6 and A4 queue mappings", () => {
  assert.deepEqual(validateApprovedArrivalPrinterMapping({
    printerKey: "shipping-a6",
    cupsPrinter: "Brother_QL_1110NWB",
    media: "4x6",
  }), { printerKey: "shipping-a6", cupsPrinter: "Brother_QL_1110NWB", media: "4x6" });
  assert.deepEqual(validateApprovedArrivalPrinterMapping({
    printerKey: "shipping-a4-delivery-note",
    cupsPrinter: "HP_Color_LaserJet_Pro_MFP_3302",
    media: "A4",
  }), { printerKey: "shipping-a4-delivery-note", cupsPrinter: "HP_Color_LaserJet_Pro_MFP_3302", media: "A4" });
  assert.throws(() => validateApprovedArrivalPrinterMapping({
    printerKey: "shipping-a4-delivery-note",
    cupsPrinter: "Brother_QL_1110NWB",
    media: "A4",
  }), /freigegebenen Zuordnung/);
  assert.throws(() => validateApprovedArrivalPrinterMapping({
    printerKey: "shipping-a6",
    cupsPrinter: "HP_Color_LaserJet_Pro_MFP_3302",
    media: "4x6",
  }), /freigegebenen Zuordnung/);
});

test("print PDF verification requires PDF magic, size and exact SHA-256", () => {
  const bytes = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(200)}\n%%EOF`);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(assertPrintPdf(bytes, sha), sha);
  assert.throws(() => assertPrintPdf(bytes, "0".repeat(64)), /Pruefsumme/);
  assert.throws(() => assertPrintPdf(new TextEncoder().encode("not a pdf"), sha), /Groesse|kein PDF/);
});

test("print API input and document streams are size bounded", async () => {
  const valid = new Request("https://ops.example.invalid/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId: "office-worker-01" }),
  });
  assert.deepEqual(await readBoundedJson(valid), { workerId: "office-worker-01" });
  await assert.rejects(
    readBoundedJson(new Request("https://ops.example.invalid/print", { method: "POST", body: "{}" })),
    /Content-Type/,
  );
  await assert.rejects(
    readBoundedResponseBytes(new Response("x".repeat(20), { headers: { "Content-Length": "20" } }), 10),
    /groesser/,
  );
});

test("CUPS job IDs are parsed without trusting free-form output", () => {
  assert.equal(parseCupsJobId("request id is Zebra-ZD421-123 (1 file(s))"), "Zebra-ZD421-123");
  assert.equal(parseCupsJobId("Anfrage-ID ist Brother_QL_1110NWB\u2013177 (1 Datei(en))"), "Brother_QL_1110NWB-177");
  assert.throws(() => parseCupsJobId("accepted but no identifier"), /Job-ID/);
});

test("CUPS adapter uses argument arrays, A6 media and no scaling option", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === "lp" && args.includes("-d")) return { exitCode: 0, stdout: "request id is Zebra-ZD421-42", stderr: "" };
    if (command === "ipptool") return { exitCode: 0, stdout: ippReceipt(), stderr: "" };
    if (command === "lpoptions") return { exitCode: 0, stdout: "PageSize/Page Size: *A6 A4 4x6", stderr: "" };
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };
  const printer = createCupsPrinter({ cupsPrinter: "Zebra-ZD421", media: "A6", runner });
  await printer.selfTest();
  const jobId = await printer.submit("/tmp/controlled-label.pdf");
  assert.equal(jobId, "Zebra-ZD421-42");
  assert.equal(await printer.isCompleted(jobId), true);
  const submit = calls.find((call) => call.command === "lp" && call.args.includes("-d"));
  assert.deepEqual(submit?.args, ["-d", "Zebra-ZD421", "-o", "media=A6", "-o", "sides=one-sided", "/tmp/controlled-label.pdf"]);
  assert.doesNotMatch(JSON.stringify(submit?.args), /fit-to-page|scaling/);
  assert.deepEqual(calls.slice(0, 2), [
    { command: "lpstat", args: ["-p", "Zebra-ZD421"] },
    { command: "lpoptions", args: ["-p", "Zebra-ZD421", "-l"] },
  ]);
});

test("bounded CUPS history preserves newest completed jobs after 16 KB", async () => {
  const newestJob = "Brother_QL_1110NWB-189 daniel 40960 Thu";
  const oldHistory = Array.from({ length: 500 }, (_, index) => `Brother_QL_1110NWB-${index} daniel 40960 Wed`).join("\n");
  const result = await runBoundedProcess(process.execPath, [
    "-e",
    `process.stdout.write(${JSON.stringify(`${newestJob}\n${oldHistory}`)})`,
  ]);

  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.length <= 16_000);
  assert.match(result.stdout, /^Brother_QL_1110NWB-189 /);
});

test("CUPS media inspection requires an exact advertised value", () => {
  const output = "PageSize/Page Size: 100x150mm *4x6 A4\nDuplex/Duplex: None";
  assert.equal(cupsSupportsMedia(output, "4x6"), true);
  assert.equal(cupsSupportsMedia(output, "A4"), true);
  assert.equal(cupsSupportsMedia(output, "A6"), false);
  assert.equal(cupsSupportsMedia("PageSize/Page Size: 4x6Borderless", "4x6"), false);
});

test("CUPS rejection does not fabricate a submitted job", async () => {
  const runner: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "printer stopped" });
  const printer = createCupsPrinter({ cupsPrinter: "Zebra-ZD421", media: "A6", runner });
  await assert.rejects(printer.submit("/tmp/controlled-label.pdf"), /printer stopped/);
});


function ippReceipt(state = "completed", changes: Record<string, string> = {}) {
  return Object.entries({
    "status-code": "successful-ok (successful-ok)",
    "job-id (integer)": "42",
    "job-printer-uri (uri)": "ipp://localhost/printers/Zebra-ZD421",
    "job-state (enum)": state,
    "job-state-reasons (keyword)": "none",
    "job-media-sheets-completed (integer)": "1",
    ...changes,
  }).map(([key, value]) => `        ${key} = ${value}`).join("\n");
}

test("completed-list membership is insufficient: require exact successful IPP receipt and a sheet", async () => {
  for (const [state, changes, expected] of [
    ["completed", {}, true], ["completed", { "job-printer-uri (uri)": "ipp://localhost:631/printers/Zebra-ZD421" }, true], ["canceled", {}, false], ["aborted", {}, false], ["processing", {}, false],
    ["completed", { "job-media-sheets-completed (integer)": "0" }, false],
    ["completed", { "job-media-sheets-completed (integer)": "unknown" }, false],
    ["completed", { "job-id (integer)": "43" }, false],
    ["completed", { "job-printer-uri (uri)": "ipp://localhost/printers/Other" }, false],
    ["completed", { "job-state-reasons (keyword)": "job-completed-with-errors" }, false],
    ["completed", { "job-state-reasons (keyword)": "job-completed-with-warnings" }, false],
  ] as Array<[string, Record<string, string>, boolean]>) {
    const runner: ProcessRunner = async (command) => ({ exitCode: 0, stderr: "",
      stdout: command === "ipptool" ? ippReceipt(state, changes) : "Zebra-ZD421-42 owner 1024 Mon" });
    const printer = createCupsPrinter({ cupsPrinter: "Zebra-ZD421", media: "A6", runner });
    assert.equal(await printer.isCompleted("Zebra-ZD421-42"), expected, JSON.stringify({state,changes}));
  }
});

test("missing IPP evidence and foreign queue job IDs cannot confirm a print", async () => {
  for (const result of [{ exitCode: 1, stdout: "", stderr: "offline" }, { exitCode: 0, stdout: "", stderr: "" }]) {
    const printer = createCupsPrinter({ cupsPrinter: "Zebra-ZD421", media: "A6", runner: async () => result });
    assert.equal(await printer.isCompleted("Zebra-ZD421-42"), false);
    await assert.rejects(printer.isCompleted("Other-42"), /Job-ID/);
  }
});


test("readiness fails before any submission when the IPP receipt tool is unavailable", async () => {
  const calls: string[] = [];
  const printer = createCupsPrinter({ cupsPrinter: "Zebra-ZD421", media: "A6", runner: async (command) => {
    calls.push(command);
    return { exitCode: command === "ipptool" ? 1 : 0, stdout: "PageSize/Page Size: *A6", stderr: "" };
  } });
  await assert.rejects(printer.selfTest(), /nicht bereit/);
  assert.equal(calls.includes("lp"), false);
});

test("Brother requires a unique direct device completion receipt, never local accounting alone", async () => {
  const uri = "ipp://192.168.0.122:631/ipp/print/job-3596";
  const name = "71caadce-1f6c-45d6-bc1e-bf6d47f59d85.pdf";
  const local = ippReceipt("completed", { "job-printer-uri (uri)": "ipp://localhost/printers/Brother_QL_1110NWB", "job-name (nameWithoutLanguage)": name });
  const device = `job-id (integer) = 3596\nrequesting-user-name (nameWithoutLanguage) = leo-print\n` + ippReceipt("completed", { "job-id (integer)": "3596", "job-uri (uri)": uri, "job-name (nameWithoutLanguage)": name, "job-state-reasons (keyword)": "job-completed-successfully", "job-impressions-completed (integer)": "1" });
  const header = "status-code = successful-ok-ignored-or-substituted-attributes (successful-ok-ignored-or-substituted-attributes)\n";
  const block = `job-id (integer) = 3596\njob-uri (uri) = ${uri}\njob-name (nameWithoutLanguage) = ${name}\n`;
  for (const [label, history, receipt, expected] of [
    ["missing device history", header, device, false],
    ["truncated device history", header + block + "x".repeat(16_000), device, false],
    ["device transport error", header + block, device.replace("status-code = successful-ok (successful-ok)", "status-code = server-error-internal-error (No request sent.)"), false],
    ["positive device receipt", header + block, device, true],
    ["ambiguous repeated name", header + block + block, device, false],
    ["foreign document", header + block.replace(name, "other.pdf"), device, false],
    ["device still processing", header + block, device.replace("= completed", "= processing"), false],
    ["no device page", header + block, device.replace("job-impressions-completed (integer) = 1", "job-impressions-completed (integer) = 0"), false],
    ["device warnings", header + block, device.replace("job-completed-successfully", "job-completed-with-warnings"), false],
    ["foreign device URI", header + block.replace("192.168.0.122", "192.168.0.123"), device, false],
    ["mismatched direct receipt", header + block, device.replace(name, "other.pdf"), false],
  ] as Array<[string, string, string, boolean]>) {
    const calls: string[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push(command);
      if (command === "lpstat") return { exitCode: 0, stdout: "device for Brother_QL_1110NWB: ipp://192.168.0.122/ipp/print", stderr: "" };
      if (args.includes("ipp://localhost/jobs/42")) return { exitCode: 0, stdout: local, stderr: "" };
      if (args.some(a => a.endsWith("get-completed-jobs.test"))) return { exitCode: 1, stdout: history, stderr: "" };
      return { exitCode: 0, stdout: receipt, stderr: "" };
    };
    const printer = createCupsPrinter({ cupsPrinter: "Brother_QL_1110NWB", media: "4x6", runner });
    assert.equal(await printer.isCompleted("Brother_QL_1110NWB-42"), expected, label);
    assert.equal(calls.includes("lp"), false, "confirmation never reprints");
  }
});
