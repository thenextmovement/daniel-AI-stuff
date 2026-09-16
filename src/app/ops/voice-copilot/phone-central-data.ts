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
