export function dialPhoneNumber(value: string) {
  if (!/^[+\d\s()./-]+$/.test(value)) return null;
  const phone = value.replace(/^(\+|00)49\s*\(0\)/, "$149").replace(/[\s()./-]/g, "");
  return /^\+?\d{6,15}$/.test(phone) ? phone : null;
}

export async function readPhoneCentralResponse<T>(response: Response, fallback: string): Promise<T> {
  // Proxies can return HTML even while the Ops session is valid.
  if (response.status === 401) throw new Error("Deine Sitzung ist abgelaufen. Bitte öffne die Seite erneut.");
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.ok !== true) throw new Error(fallback);
  return data as T;
}

// A brief upstream outage must not leave the directory stuck until a manual reload.
// Only this read is retried; session/validation errors and cancelled searches are not.
export async function fetchPhoneDirectory<T>(url: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      });
    } catch (error) {
      if (signal.aborted || attempt === 1) throw error;
      continue;
    }
    if (attempt === 0 && [500, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      continue;
    }
    return readPhoneCentralResponse<T>(response, "Kunden konnten nicht geladen werden. Bitte versuche es erneut.");
  }
  throw new Error("Kunden konnten nicht geladen werden.");
}
