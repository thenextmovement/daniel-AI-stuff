import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { DunningCaseSummary } from "@/lib/ops/dunning";
import {
  createDunningCourtDraftJob,
  recordDunningCourtDraftCreated,
  updateDunningCourtDraftJob,
  type DunningCourtDraftJob,
  type DunningCourtProfile,
} from "@/lib/ops/dunning-court";

const OFFICIAL_MAHNANTRAG_URL = "https://www.online-mahnantrag.de/";
const MAX_PDF_BYTES = 2_800_000;
// § 23 Nr. 1 GVG: Amtsgerichte are competent through 10,000 EUR since 2026.
const AMTSGERICHT_MAX_AMOUNT_CENTS = 1_000_000;

type ApplicantConfig = {
  legalName: string;
  legalForm: "GmbH";
  street: string;
  postalCode: string;
  city: string;
  representativeName: string;
  iban: string;
  bic: string;
  mailbox: string;
  internalRecipient: string;
};

export type DunningCourtApplicationPreview = {
  orderNumber: string;
  debtorLabel: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  currency: string;
  profileVerifiedAt: string;
  sourceUrl: string;
  internalRecipient: string | null;
  officialPortal: typeof OFFICIAL_MAHNANTRAG_URL;
  confirmationPhrase: string;
  blockers: string[];
  warnings: string[];
  allowed: boolean;
  snapshotHash: string;
  snapshot: Record<string, unknown>;
};

function clean(value: unknown, max = 200) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function requiredEnv(name: string) {
  const value = clean(process.env[name], 500);
  if (!value) throw new Error("DUNNING_COURT_NOT_CONFIGURED");
  return value;
}

function internalEmail(value: unknown) {
  const email = clean(value, 180).toLowerCase();
  return /^[a-z0-9._%+-]+@(neontrip[.]de|daranova[.]de)$/.test(email)
    ? email
    : null;
}

function applicantConfig(): ApplicantConfig {
  const iban = requiredEnv("DUNNING_COURT_APPLICANT_IBAN")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!/^DE[0-9]{20}$/.test(iban))
    throw new Error("DUNNING_COURT_NOT_CONFIGURED");
  const internalRecipient = internalEmail(
    process.env.DUNNING_COURT_INTERNAL_RECIPIENT,
  );
  if (!internalRecipient) throw new Error("DUNNING_COURT_NOT_CONFIGURED");
  const bic = requiredEnv("DUNNING_COURT_APPLICANT_BIC").toUpperCase();
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic))
    throw new Error("DUNNING_COURT_NOT_CONFIGURED");
  return {
    legalName: "DARA NOVA",
    legalForm: "GmbH",
    street: "Bilker Allee 29",
    postalCode: "40219",
    city: "Düsseldorf",
    representativeName: "Daniel Klesse",
    iban,
    bic,
    mailbox: requiredEnv("MICROSOFT_GRAPH_MAILBOX"),
    internalRecipient,
  };
}

export function dunningCourtApplicationConfigured() {
  try {
    applicantConfig();
    requiredEnv("MICROSOFT_GRAPH_TENANT_ID");
    requiredEnv("MICROSOFT_GRAPH_CLIENT_ID");
    requiredEnv("MICROSOFT_GRAPH_CLIENT_SECRET");
    return true;
  } catch {
    return false;
  }
}

function berlinDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function germanDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error("DUNNING_COURT_INVOICE_DATE_MISSING");
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function germanAmount(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 1)
    throw new Error("DUNNING_COURT_AMOUNT_INVALID");
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

function germanAmountLabel(cents: number) {
  return (
    new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100) + " EUR"
  );
}

function profileFresh(profile: DunningCourtProfile, days: number) {
  const checked = Date.parse(profile.sourceCheckedAt);
  return (
    Number.isFinite(checked) &&
    Date.now() - checked <= days * 86_400_000 &&
    checked <= Date.now() + 300_000
  );
}

export function createDunningCourtApplicationPreview(input: {
  summary: DunningCaseSummary;
  profile: DunningCourtProfile | null;
  latestJob: DunningCourtDraftJob | null;
}): DunningCourtApplicationPreview {
  const { summary, profile, latestJob } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const invoiceDate = summary.invoiceDate || summary.orderCreatedAt || "";
  const invoiceNumber = clean(
    summary.easybillInvoiceNumber || summary.orderNumber,
    35,
  ).replace(/^#/, "");

  if (!summary.legalReviewReady || summary.state !== "court_review")
    blockers.push("Fall ist noch nicht für die gerichtliche Prüfung freigegeben");
  if (summary.amountCents < 1 || summary.financialStatus === "paid")
    blockers.push("Offene Forderung ist nicht mehr belegt");
  if (summary.currency !== "EUR")
    blockers.push("Automatischer Barcode-Antrag ist derzeit nur für EUR freigegeben");
  if (!invoiceNumber || !invoiceDate)
    blockers.push("Rechnungsnummer oder Rechnungsdatum fehlt");
  if (!profile)
    blockers.push("Aktuelle Register-, Vertretungs- und Zustelldaten wurden noch nicht geprüft");
  if (profile && !profileFresh(profile, 30))
    blockers.push("Die geprüften Registerdaten sind älter als 30 Tage");
  if (
    profile &&
    (!Number.isFinite(Date.parse(profile.communicationCheckedAt)) ||
      Date.parse(profile.communicationCheckedAt) < Date.parse(profile.verifiedAt) - 300_000)
  )
    blockers.push("Der vollständige E-Mail-Verlauf wurde nicht zusammen mit den Gerichtsdaten geprüft");
  if (
    !summary.insolvencyCheck ||
    summary.insolvencyCheck.status !== "completed" ||
    summary.insolvencyCheck.resultCode !== "no_public_notice_found"
  )
    blockers.push("Amtliche Insolvenzprüfung ist nicht ohne Veröffentlichung abgeschlossen");
  if (summary.customerReplied)
    blockers.push("Eine Kundenantwort muss vor dem Antrag geklärt werden");
  if (!summary.hasTracking)
    blockers.push("Sendungsnummer oder anderer Lieferhinweis fehlt");
  else if (!summary.carrierDeliveryConfirmed)
    warnings.push("Sendungsnummer vorhanden; dauerhafter Carrier-Zustellnachweis ist noch nicht archiviert");
  if (summary.courtEvents.some((event) => event.eventType === "application_draft_created"))
    blockers.push("Für diesen Fall ist bereits ein Mahnantragsentwurf erfasst");
  if (
    latestJob &&
    ["pending", "processing", "pdf_created", "email_dispatching", "email_sent"].includes(
      latestJob.status,
    )
  )
    blockers.push("Eine gerichtliche PDF-Vorbereitung läuft bereits oder ist abgeschlossen");
  if (!dunningCourtApplicationConfigured())
    blockers.push("Amtlicher PDF-/E-Mail-Worker ist noch nicht vollständig konfiguriert");

  const debtorLabel = profile
    ? `${profile.legalName} ${profile.legalForm}`.trim()
    : summary.company || summary.customerName || "Ungeprüfter Antragsgegner";
  const snapshot = {
    schema: "neontrip.ops.dunning.court-application.v1",
    orderNumber: summary.orderNumber,
    shopifyOrderId: summary.shopifyOrderId,
    amountCents: summary.amountCents,
    currency: summary.currency,
    invoiceNumber,
    invoiceDate,
    profile: profile
      ? {
          legalName: profile.legalName,
          legalForm: profile.legalForm,
          street: profile.street,
          postalCode: profile.postalCode,
          city: profile.city,
          countryCode: profile.countryCode,
          representatives: profile.representatives,
          verifiedAt: profile.verifiedAt,
          sourceCheckedAt: profile.sourceCheckedAt,
          communicationCheckedAt: profile.communicationCheckedAt,
        }
      : null,
    insolvencyCheckId: summary.insolvencyCheck?.id || null,
    insolvencyCheckedAt: summary.insolvencyCheck?.checkedAt || null,
    trackingNumbers: summary.shipments
      .map((shipment) => shipment.trackingNumber)
      .filter(Boolean),
  };
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  return {
    orderNumber: summary.orderNumber,
    debtorLabel,
    invoiceNumber,
    invoiceDate,
    amountCents: summary.amountCents,
    currency: summary.currency,
    profileVerifiedAt: profile?.verifiedAt || "",
    sourceUrl: profile?.sourceUrl || "",
    internalRecipient: internalEmail(
      process.env.DUNNING_COURT_INTERNAL_RECIPIENT,
    ),
    officialPortal: OFFICIAL_MAHNANTRAG_URL,
    confirmationPhrase: `AMTLICHEN ENTWURF ERSTELLEN ${summary.orderNumber}`,
    blockers,
    warnings,
    allowed: blockers.length === 0,
    snapshotHash,
    snapshot,
  };
}

function chromiumPath() {
  const configured = clean(process.env.DUNNING_COURT_CHROMIUM_PATH, 500);
  const candidates = [
    configured,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("DUNNING_COURT_BROWSER_NOT_AVAILABLE");
  return executable;
}

function officialPortalUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "www.online-mahnantrag.de"
    );
  } catch {
    return false;
  }
}

function assertOfficialPortal(page: {
  url(): string;
  frames(): Array<{ url(): string }>;
}) {
  const unexpected = [page.url(), ...page.frames().map((frame) => frame.url())]
    .filter(Boolean)
    .find(
      (url) =>
        !url.startsWith("about:") &&
        !url.startsWith("chrome-extension:") &&
        !officialPortalUrl(url),
    );
  if (unexpected) throw new Error("DUNNING_COURT_PORTAL_ORIGIN_INVALID");
}

async function generateOfficialBarcodePdf(input: {
  preview: DunningCourtApplicationPreview;
  profile: DunningCourtProfile;
  applicant: ApplicantConfig;
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ locale: "de-DE" });
    page.setDefaultTimeout(20_000);
    await page.goto(OFFICIAL_MAHNANTRAG_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const cookieConsent = page.getByText("Ich stimme zu", { exact: true });
    if ((await cookieConsent.count()) > 0) {
      await cookieConsent.first().click();
      await page.waitForLoadState("domcontentloaded");
    }
    assertOfficialPortal(page);
    const main = () => page.frameLocator('frame[name="main"]');
    const nestedForm = () =>
      main().frameLocator('frame[name="form"]');
    const next = async (scope: ReturnType<typeof main>) => {
      await scope.locator('input[type="image"][name^="Weiter"]').click();
      await page.waitForTimeout(250);
    };

    await main()
      .locator('select[name="Bundesland"]')
      .selectOption({ label: "Nordrhein-Westfalen" });
    await next(main());
    await main()
      .locator('input[name="_bVersandart"][value="Barcode"]')
      .check();
    await next(main());
    await main().locator('input[type="image"][name="neuer Antrag"]').click();
    await page.waitForTimeout(250);
    await main().locator('input[type="image"][name="Weiter AS"]').click();
    await page.waitForTimeout(250);

    assertOfficialPortal(page);
    await nestedForm().getByText("Firma", { exact: true }).click();
    await page.waitForTimeout(150);
    let form = nestedForm();
    await form.locator('input[name="_bName1"]').fill(input.applicant.legalName);
    await form.locator('input[name="_bStr"]').fill(input.applicant.street);
    await form.locator('input[name="_bPLZ"]').fill(input.applicant.postalCode);
    await form.locator('input[name="_bOrt"]').fill(input.applicant.city);
    await form
      .locator('select[name="_bRechtsform"]')
      .selectOption({ label: input.applicant.legalForm });
    await next(form);
    form = nestedForm();
    await form
      .locator('select[name="_gvVertreterFunktion"]')
      .selectOption({ label: "Geschäftsführer" });
    await form
      .locator('input[name="_gvName1"]')
      .fill(input.applicant.representativeName);
    await next(form);
    await nestedForm().locator('input[type="image"][name="Nein"]').click();
    await page.waitForTimeout(200);
    await nestedForm().locator('input[type="image"][name="Nein"]').click();
    await page.waitForTimeout(250);
    await next(main());

    await nestedForm().getByText("Firma", { exact: true }).click();
    await page.waitForTimeout(150);
    form = nestedForm();
    await form.locator('input[name="_bName1"]').fill(input.profile.legalName);
    await form.locator('input[name="_bStr"]').fill(input.profile.street);
    await form.locator('input[name="_bPLZ"]').fill(input.profile.postalCode);
    await form.locator('input[name="_bOrt"]').fill(input.profile.city);
    await form
      .locator('select[name="_bRechtsform"]')
      .selectOption({ label: input.profile.legalForm });
    await next(form);
    for (let index = 0; index < input.profile.representatives.length; index += 1) {
      const representative = input.profile.representatives[index]!;
      form = nestedForm();
      await form
        .locator('select[name="_gvVertreterFunktion"]')
        .selectOption({ label: representative.function });
      await form.locator('input[name="_gvName1"]').fill(representative.name);
      await next(form);
      form = nestedForm();
      if (index < input.profile.representatives.length - 1) {
        await form
          .locator('a[href*="leereViewDocumentAGGVundShowAGGV"]')
          .click();
      } else {
        await form.locator('input[type="image"][name="Nein"]').click();
      }
      await page.waitForTimeout(180);
    }
    await nestedForm().locator('input[type="image"][name="Nein"]').click();
    await page.waitForTimeout(250);

    await main()
      .locator('input[name="_bVerfahrensArt"][value="NMV"]')
      .check();
    await next(main());
    form = nestedForm();
    await form.locator('select[name="_bKatalogArt"]').selectOption("44");
    await form.locator('select[name="_aspAspGr"]').selectOption("Rechnung");
    await form.locator('input[name="_bAspNr"]').fill(input.preview.invoiceNumber);
    await form
      .locator('input[name="_bVon"]')
      .fill(germanDate(input.preview.invoiceDate));
    await form
      .locator('input[name="_bBetrag"]')
      .fill(germanAmount(input.preview.amountCents));
    await next(form);
    form = nestedForm();
    await form
      .locator('input[name="MehrAbtretungZinsenAnspruch"][value="Weiter"]')
      .check();
    await next(form);
    await next(main());

    const processCourtText = await main().locator("body").innerText();
    if (!processCourtText.includes("Prozessgerichtsdaten"))
      throw new Error("DUNNING_COURT_PROCESS_COURT_MISSING");
    if (
      input.preview.amountCents > AMTSGERICHT_MAX_AMOUNT_CENTS &&
      !processCourtText.includes("Landgericht")
    )
      throw new Error("DUNNING_COURT_PROCESS_COURT_INVALID");
    await next(main());
    await main()
      .locator('input[name="_bAntragstellerGeschaeftszeichen"]')
      .fill(input.preview.orderNumber.replace(/^#/, ""));
    await main()
      .locator('input[name="_bErklaerungVorGegenLeistung1"]')
      .check();
    await next(main());
    assertOfficialPortal(page);
    await main().locator('input[name="_bIban"]').fill(input.applicant.iban);
    await main().locator('input[name="_bBic"]').fill(input.applicant.bic);
    await main()
      .locator('select[name="_bKontoZuordnung"]')
      .selectOption({
        label: "Der erste/einzige Antragsteller ist Kontoinhaber.",
      });
    await next(main());

    const overview = await main().locator("body").innerText();
    const requiredOverviewValues = [
      input.applicant.legalName,
      input.applicant.street,
      input.applicant.postalCode,
      input.applicant.city,
      input.applicant.representativeName,
      input.applicant.iban,
      input.applicant.bic,
      input.profile.legalName,
      input.profile.street,
      input.profile.postalCode,
      input.profile.city,
      ...input.profile.representatives.map((entry) => entry.name),
      "Der erste/einzige Antragsteller ist Kontoinhaber.",
      "Werkvertrag/Werklieferungsvertrag",
      "(Katalog-Nr. 44)",
      "Rechnung",
      input.preview.invoiceNumber,
      germanDate(input.preview.invoiceDate),
      germanAmountLabel(input.preview.amountCents),
      "Amtsgericht Hagen",
      "Zentrale Mahnabteilung",
    ];
    if (requiredOverviewValues.some((value) => !overview.includes(value)))
      throw new Error("DUNNING_COURT_OVERVIEW_MISMATCH");
    await next(main());
    await main().locator('input[name="hinweisGelesen"]').check();
    const chromiumHint = main().locator('input[name="hinweisGelesenChrome"]');
    if ((await chromiumHint.count()) > 0) await chromiumHint.check();
    const pdfResponsePromise = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        officialPortalUrl(response.url()) &&
        response.url().includes("Command=barcodeMB"),
      { timeout: 45_000 },
    );
    await main()
      .locator('input[type="image"][name^="Ja, MB-Antrag drucken"]')
      .evaluate((element) => (element as HTMLElement).click());
    const pdfPageResponse = await pdfResponsePromise;
    if (!officialPortalUrl(pdfPageResponse.url()))
      throw new Error("DUNNING_COURT_PORTAL_ORIGIN_INVALID");
    const pdfResponse = await page.context().request.get(pdfPageResponse.url(), {
      failOnStatusCode: false,
      timeout: 45_000,
    });
    const contentType = pdfResponse.headers()["content-type"] || "";
    if (!pdfResponse.ok()) throw new Error("DUNNING_COURT_PDF_INVALID");
    if (!contentType.toLowerCase().includes("application/pdf"))
      throw new Error("DUNNING_COURT_PDF_INVALID");
    const pdf = Buffer.from(await pdfResponse.body());
    if (pdf.length > MAX_PDF_BYTES)
      throw new Error("DUNNING_COURT_PDF_TOO_LARGE");
    if (pdf.length < 1_000) throw new Error("DUNNING_COURT_PDF_INVALID");
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error("DUNNING_COURT_PDF_INVALID");
    const document = await PDFDocument.load(pdf, { ignoreEncryption: true });
    if (document.getPageCount() < 3 || document.getPageCount() > 6)
      throw new Error("DUNNING_COURT_PDF_INVALID");
    return {
      pdf,
      overview,
      overviewSha256: createHash("sha256").update(overview).digest("hex"),
      processCourt: clean(
        processCourtText.match(/Anschrift:\s*([^\n]+\n\s*[^\n]+)/)?.[1],
        180,
      ),
    };
  } finally {
    await browser.close();
  }
}

async function graphToken() {
  const clientId =
    String(process.env.MICROSOFT_GRAPH_CLIENT_ID_NEXT || "").trim() ||
    requiredEnv("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret =
    String(process.env.MICROSOFT_GRAPH_CLIENT_SECRET_NEXT || "").trim() ||
    requiredEnv("MICROSOFT_GRAPH_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(
      requiredEnv("MICROSOFT_GRAPH_TENANT_ID"),
    )}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
  } | null;
  if (!response.ok || !payload?.access_token)
    throw new Error("DUNNING_COURT_GRAPH_TOKEN_FAILED");
  return payload.access_token;
}

async function createGraphDraft(input: {
  applicant: ApplicantConfig;
  preview: DunningCourtApplicationPreview;
  fileName: string;
  pdf: Buffer;
}) {
  const token = await graphToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      input.applicant.mailbox,
    )}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: `[Unterschrift erforderlich] Gerichtlicher Mahnantrag ${input.preview.orderNumber}`,
        body: {
          contentType: "HTML",
          content:
            `<p>Der amtliche Barcode-Mahnantrag für <strong>${html(input.preview.orderNumber)}</strong> wurde über online-mahnantrag.de erstellt und technisch geprüft.</p>` +
            `<p><strong>Antragsgegner:</strong> ${html(input.preview.debtorLabel)}<br><strong>Hauptforderung:</strong> ${html(germanAmountLabel(input.preview.amountCents))}</p>` +
            "<p>Bitte PDF vollständig prüfen, einseitig auf weißem DIN-A4-Papier ausdrucken, unterschreiben und per Post an das im Antrag genannte Amtsgericht Hagen senden.</p>" +
            "<p><strong>Noch nicht eingereicht:</strong> Diese E-Mail und der PDF-Entwurf bewirken weder eine gerichtliche Prüfung noch einen gelben Brief.</p>",
        },
        toRecipients: [
          {
            emailAddress: {
              address: input.applicant.internalRecipient,
            },
          },
        ],
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: input.fileName,
            contentType: "application/pdf",
            contentBytes: input.pdf.toString("base64"),
          },
        ],
      }),
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  if (!response.ok || !payload?.id)
    throw new Error("DUNNING_COURT_GRAPH_DRAFT_FAILED");
  return { id: payload.id, token };
}

async function sendGraphDraft(input: {
  applicant: ApplicantConfig;
  draftId: string;
  token: string;
}) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      input.applicant.mailbox,
    )}/messages/${encodeURIComponent(input.draftId)}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("DUNNING_COURT_GRAPH_SEND_UNCERTAIN");
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^DUNNING_COURT_[A-Z0-9_]+$/.test(message)
    ? message
    : "DUNNING_COURT_UNEXPECTED";
}

function html(value: unknown) {
  return clean(value, 500)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function ensureDraftEvent(job: DunningCourtDraftJob) {
  if (!job.pdfFilename || !job.pdfSha256)
    throw new Error("DUNNING_COURT_JOB_INCOMPLETE");
  await recordDunningCourtDraftCreated({
    orderNumber: job.orderNumber,
    eventKey: `court-draft:${job.id}`,
    occurredOn: berlinDate(),
    sourceReference: `${job.pdfFilename} · SHA256 ${job.pdfSha256}`,
    actor: job.requestedBy,
    note:
      "Amtlicher Barcode-PDF-Entwurf über online-mahnantrag.de erzeugt und intern zur Unterschrift versendet; nicht beim Gericht eingereicht und nicht zugestellt.",
  });
}

export async function prepareDunningCourtApplication(input: {
  preview: DunningCourtApplicationPreview;
  profile: DunningCourtProfile;
  actor: string;
  idempotencyKey: string;
}) {
  if (!input.preview.allowed) throw new Error("DUNNING_COURT_BLOCKED");
  const applicant = applicantConfig();
  let job = await createDunningCourtDraftJob({
    orderNumber: input.preview.orderNumber,
    idempotencyKey: input.idempotencyKey,
    snapshotHash: input.preview.snapshotHash,
    caseSnapshot: input.preview.snapshot,
    requestedBy: input.actor,
  });
  if (
    job.idempotencyKey !== input.idempotencyKey ||
    job.snapshotHash !== input.preview.snapshotHash
  )
    throw new Error("DUNNING_COURT_DUPLICATE_OR_STALE");
  if (job.status === "email_sent") {
    await ensureDraftEvent(job);
    return job;
  }
  if (!["pending", "retryable_error"].includes(job.status))
    throw new Error("DUNNING_COURT_JOB_ALREADY_RUNNING");

  try {
    job = await updateDunningCourtDraftJob(job.id, {
      status: "processing",
      processing_at: new Date().toISOString(),
      last_error_code: null,
    }, ["pending", "retryable_error"]);
    const generated = await generateOfficialBarcodePdf({
      preview: input.preview,
      profile: input.profile,
      applicant,
    });
    const pdfSha256 = createHash("sha256").update(generated.pdf).digest("hex");
    const fileName = `${input.preview.orderNumber.slice(
      1,
    )}_Barcode-Mahnantrag_${berlinDate()}.pdf`;
    job = await updateDunningCourtDraftJob(job.id, {
      status: "pdf_created",
      pdf_filename: fileName,
      pdf_sha256: pdfSha256,
      pdf_bytes: generated.pdf.length,
      overview_sha256: generated.overviewSha256,
      internal_recipient: applicant.internalRecipient,
    });
    let draft: { id: string; token: string };
    try {
      draft = await createGraphDraft({
        applicant,
        preview: input.preview,
        fileName,
        pdf: generated.pdf,
      });
    } catch (error) {
      await updateDunningCourtDraftJob(job.id, {
        status: "retryable_error",
        last_error_code: safeErrorCode(error),
      });
      throw error;
    }
    job = await updateDunningCourtDraftJob(job.id, {
      status: "email_dispatching",
      graph_draft_id: draft.id,
      email_dispatching_at: new Date().toISOString(),
    });
    try {
      await sendGraphDraft({
        applicant,
        draftId: draft.id,
        token: draft.token,
      });
    } catch (error) {
      await updateDunningCourtDraftJob(job.id, {
        status: "manual_review",
        last_error_code: safeErrorCode(error),
      });
      throw error;
    }
    const completedAt = new Date().toISOString();
    job = await updateDunningCourtDraftJob(job.id, {
      status: "email_sent",
      email_sent_at: completedAt,
      completed_at: completedAt,
    });
    await ensureDraftEvent(job);
    return job;
  } catch (error) {
    const code = safeErrorCode(error);
    if (
      job.status === "processing" &&
      code !== "DUNNING_COURT_GRAPH_SEND_UNCERTAIN"
    )
      await updateDunningCourtDraftJob(job.id, {
        status: "retryable_error",
        last_error_code: code,
      }).catch(() => null);
    throw error;
  }
}
