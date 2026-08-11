const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STORAGE_BUCKET = "ro-lead-attachments";
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "ai",
  "eps",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "svg",
  "webp",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/illustrator",
  "application/octet-stream",
  "application/pdf",
  "application/postscript",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function sameSecret(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function fileExtension(name) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function cleanOriginalFileName(value) {
  return value
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

function safeStorageFileName(originalName) {
  const extension = fileExtension(originalName);
  const stem = originalName.slice(
    0,
    Math.max(0, originalName.length - extension.length - 1),
  );
  const safeStem = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "attachment";
  return `${safeStem}.${extension}`;
}

function encodedObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function objectExists(storagePath) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/` +
      `${STORAGE_BUCKET}/${encodedObjectPath(storagePath)}`,
    {
      method: "HEAD",
      headers: serviceHeaders(),
    },
  );
  return response.ok;
}

async function deleteObject(storagePath) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/` +
      encodedObjectPath(storagePath),
    {
      method: "DELETE",
      headers: serviceHeaders(),
    },
  );
  if (!response.ok && response.status !== 404) {
    console.error("Attachment compensation delete failed", response.status);
  }
}

async function recordAttachment(input) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/` +
      "ro_record_first_party_attachment_v1",
    {
      method: "POST",
      headers: serviceHeaders({
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        p_request_id: input.requestId,
        p_submission_id: input.submissionId,
        p_attachment_index: input.attachmentIndex,
        p_storage_bucket: STORAGE_BUCKET,
        p_storage_path: input.storagePath,
        p_original_file_name: input.originalFileName,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_sha256: input.sha256,
      }),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    if (/identity conflict/i.test(detail)) {
      throw new Error("attachment_identity_conflict");
    }
    if (/first-party lead was not found/i.test(detail)) {
      throw new Error("lead_not_found");
    }
    console.error("Attachment metadata registration failed", response.status);
    throw new Error("attachment_metadata_failed");
  }

  return await response.json();
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (
    !SUPABASE_URL ||
    !SERVICE_ROLE_KEY ||
    !sameSecret(request.headers.get("apikey") ?? "", SERVICE_ROLE_KEY)
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const submissionId =
    (request.headers.get("x-ro-submission-id") ?? "").toLowerCase();
  const requestId = request.headers.get("x-ro-request-id") ?? "";
  const attachmentIndex = Number(
    request.headers.get("x-ro-attachment-index") ?? "",
  );
  const originalFileName = cleanOriginalFileName(
    decodeHeader(request.headers.get("x-ro-file-name") ?? ""),
  );
  const mimeType = (
    request.headers.get("x-ro-mime-type") ??
    request.headers.get("content-type") ??
    ""
  ).split(";")[0].trim().toLowerCase();
  const extension = fileExtension(originalFileName);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      submissionId,
    ) ||
    requestId !== `riesenobjekte-first-party:${submissionId}` ||
    !Number.isInteger(attachmentIndex) ||
    attachmentIndex < 1 ||
    attachmentIndex > 5 ||
    !originalFileName
  ) {
    return json({ error: "invalid_attachment_identity" }, 400);
  }

  if (
    !ALLOWED_EXTENSIONS.has(extension) ||
    !ALLOWED_MIME_TYPES.has(mimeType)
  ) {
    return json({ error: "unsupported_file_type" }, 415);
  }

  const declaredLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_FILE_BYTES
  ) {
    return json({ error: "file_too_large" }, 413);
  }

  try {
    const fileBytes = new Uint8Array(await request.arrayBuffer());
    if (
      fileBytes.byteLength < 1 ||
      fileBytes.byteLength > MAX_FILE_BYTES
    ) {
      return json({ error: "invalid_file_size" }, 413);
    }

    const sha256 = toHex(
      await crypto.subtle.digest("SHA-256", fileBytes),
    );
    const storagePath =
      `first-party/${submissionId}/` +
      `${String(attachmentIndex).padStart(2, "0")}-` +
      `${sha256}-${safeStorageFileName(originalFileName)}`;
    const storageUrl =
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/` +
      encodedObjectPath(storagePath);

    const uploadResponse = await fetch(storageUrl, {
      method: "POST",
      headers: serviceHeaders({
        "cache-control": "3600",
        "content-type": mimeType,
        "x-upsert": "false",
      }),
      body: fileBytes,
    });

    let newlyUploaded = uploadResponse.ok;
    let storageReplay = false;
    if (!uploadResponse.ok) {
      storageReplay =
        uploadResponse.status === 400 &&
        await objectExists(storagePath);
      if (!storageReplay) {
        console.error(
          "Attachment Storage upload failed",
          uploadResponse.status,
        );
        return json({ error: "attachment_upload_failed" }, 502);
      }
      newlyUploaded = false;
    }

    try {
      const record = await recordAttachment({
        requestId,
        submissionId,
        attachmentIndex,
        storagePath,
        originalFileName,
        mimeType,
        sizeBytes: fileBytes.byteLength,
        sha256,
      });
      return json({
        stored: true,
        storage_replay: storageReplay,
        attachment_id: record.attachment_id ?? null,
        project_id: record.project_id ?? null,
        storage_bucket: STORAGE_BUCKET,
        storage_path: storagePath,
        sha256,
        size_bytes: fileBytes.byteLength,
      }, newlyUploaded ? 201 : 200);
    } catch (error) {
      if (newlyUploaded) await deleteObject(storagePath);
      const code = error instanceof Error ? error.message : "unknown";
      if (code === "attachment_identity_conflict") {
        return json({ error: code }, 409);
      }
      if (code === "lead_not_found") {
        return json({ error: code }, 409);
      }
      return json({ error: "attachment_registration_failed" }, 502);
    }
  } catch (error) {
    console.error(
      "Attachment ingest failed",
      error instanceof Error ? error.message.slice(0, 160) : "unknown",
    );
    return json({ error: "internal_error" }, 500);
  }
});

