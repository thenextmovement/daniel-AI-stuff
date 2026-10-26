import { pathToFileURL } from "node:url";

export const normalizePatches = [
  {
    "find": "  binary: attachmentItems[index]?.binary || {}\n",
    "replace": "  binary: attachmentItems[index]?.binary || {},\n  attachmentMetadata: attachmentItems[index]?.json?.attachments || []\n"
  },
  {
    "find": "  const contentId = clean(file.contentId || file.contentID || file.cid || '', 500).replace(/^<|>$/g, '');\n  const explicitInline = file.isInline === true || file.inline === true || file.attachmentType === 'inline';",
    "replace": "  // IMAP keeps CID/disposition outside n8n's filesystem-v2 binary descriptor.\n  const numericSize = [file.bytes, file.fileSize, file.size]\n    .find(value => value !== undefined && value !== null && value !== '' &&\n      Number.isSafeInteger(Number(value)) && Number(value) >= 0);\n  const sizeBytes = numericSize === undefined ? 0 : Number(numericSize);\n  const metadataMatches = asArray(email.attachmentsInfo).filter(entry =>\n    entry.filename === fileName && entry.contentType === mimeType &&\n    sizeBytes > 0 && Number(entry.size) === sizeBytes);\n  const metadata = metadataMatches.length === 1 ? metadataMatches[0] : {};\n  const downloadMatches = asArray(source.attachmentMetadata).filter(entry =>\n    entry.binaryFieldName === key && entry.filename === fileName && entry.contentType === mimeType);\n  const downloaded = downloadMatches.length === 1 ? downloadMatches[0] : {};\n  const contentId = clean(file.contentId || file.contentID || file.cid || metadata.contentId || '', 500).replace(/^<|>$/g, '');\n  const explicitInline = file.isInline === true || file.inline === true || file.attachmentType === 'inline' || downloaded.disposition === 'inline';"
  },
  {
    "find": "  const cidPosition = cidNeedle ? htmlLower.indexOf(cidNeedle) : -1;\n  const cidReferenced = cidPosition >= 0;\n  const sizeBytes = Number(file.fileSize || file.size || 0);",
    "replace": "  const htmlCidPosition = cidNeedle ? htmlLower.indexOf(cidNeedle) : -1;\n  // Only fall back to the matching CID in plaintext when the IMAP node cleaned HTML.\n  // Unknown images stay attached; image order or the filename alone is not evidence.\n  const signatureSource = email.htmlCleaned === true && htmlCidPosition < 0\n    ? String(email.textContent || '').toLowerCase() : htmlLower;\n  const cidPosition = cidNeedle ? signatureSource.indexOf(cidNeedle) : -1;\n  const cidReferenced = cidPosition >= 0;"
  },
  {
    "find": "    .map((pattern) => htmlLower.search(pattern))",
    "replace": "    .map((pattern) => signatureSource.search(pattern))"
  }
];

export const patch = {
  workflowId: "rCgjDFQeytL0n5Zl",
  expectedNodeCount: 32,
  expectedActiveVersionId: "011ff6a3-df45-4c26-860d-594ef3d6d6e3",
  operations: [{ type: "patchNodeField", nodeName: "Normalize Oldest Outlook Inquiry", fieldPath: "parameters.jsCode", patches: normalizePatches }],
};

export function applyNormalizePatch(code) {
  for (const { find, replace } of normalizePatches) {
    if (code.split(find).length !== 2) throw new Error("Normalizer baseline mismatch");
    code = code.replace(find, replace);
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(patch));
}
