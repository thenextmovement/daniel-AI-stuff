type PortalChangeBody = {
  billingAddress?: unknown;
  deliveryAddress?: unknown;
  vatId?: unknown;
  invoiceEmail?: unknown;
  projectNumber?: unknown;
  requesterEmail?: unknown;
};

const ROOT_FIELDS = new Set(["billingAddress", "deliveryAddress", "vatId", "invoiceEmail", "projectNumber", "requesterEmail"]);
const ADDRESS_FIELDS = new Set(["company", "name", "firstName", "lastName", "street", "zip", "city", "country"]);

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max: number) {
  if (typeof value !== "string") throw new Error("invalid_portal_change");
  const normalized = value.trim();
  if (normalized.length > max) throw new Error("invalid_portal_change");
  return normalized;
}

function address(value: unknown) {
  if (!plainRecord(value)) throw new Error("invalid_portal_change");
  if (Object.keys(value).some((key) => !ADDRESS_FIELDS.has(key))) throw new Error("invalid_portal_change");
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = boundedText(entry, key === "street" ? 200 : 120);
  return result;
}

export function sanitizePortalChangeBody(value: unknown) {
  if (!plainRecord(value) || Object.keys(value).some((key) => !ROOT_FIELDS.has(key))) {
    throw new Error("invalid_portal_change");
  }
  const body = value as PortalChangeBody;
  const changes: Record<string, unknown> = {};
  if (body.billingAddress !== undefined) changes.billingAddress = address(body.billingAddress);
  if (body.deliveryAddress !== undefined) changes.deliveryAddress = address(body.deliveryAddress);
  if (body.vatId !== undefined) {
    const vatId = boundedText(body.vatId, 40);
    if (vatId && !/^[A-Za-z0-9 .\-\/]+$/.test(vatId)) throw new Error("invalid_portal_change");
    changes.vatId = vatId;
  }
  if (body.invoiceEmail !== undefined) {
    const invoiceEmail = boundedText(body.invoiceEmail, 254).toLowerCase();
    if (!invoiceEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail)) throw new Error("invalid_portal_change");
    changes.invoiceEmail = invoiceEmail;
  }
  if (body.projectNumber !== undefined) {
    const projectNumber = boundedText(body.projectNumber, 100);
    if (projectNumber && /[<>\u0000-\u001F\u007F]/u.test(projectNumber)) throw new Error("invalid_portal_change");
    changes.projectNumber = projectNumber;
  }
  if (!Object.keys(changes).length) throw new Error("no_allowed_changes");
  const requesterEmail = body.requesterEmail === undefined ? null : boundedText(body.requesterEmail, 254).toLowerCase();
  if (requesterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) throw new Error("invalid_portal_change");
  return { changes, requesterEmail };
}
