function isLocalOrPrivateHostname(hostnameValue: string) {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || /^0\./.test(hostname)
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    || hostname.includes(":")
  );
}

export function safeExternalSegmentationEvidenceUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username
      || parsed.password
      || !parsed.hostname
      || isLocalOrPrivateHostname(parsed.hostname)
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function safeSegmentationModelEvidenceLinks(evidence: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return evidence.flatMap((entry) => {
    if (typeof entry.url !== "string" || entry.url.length > 2048) return [];
    const url = safeExternalSegmentationEvidenceUrl(entry.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const parsed = new URL(url);
    return [{
      url,
      host: parsed.hostname,
      type: typeof entry.type === "string" ? entry.type : "unknown",
      usedFor: typeof entry.used_for === "string" ? entry.used_for : "unknown",
      evidenceCode: typeof entry.evidence_code === "string" ? entry.evidence_code : "unknown",
    }];
  });
}
