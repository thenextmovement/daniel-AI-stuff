"use client";
import { useRef, useState } from "react";
import { Phone } from "lucide-react";
import styles from "./phone-central.module.css";

export function PlacetelCallButton({ customerId, requestId, disabled }: {
  customerId: string; requestId: string; disabled: boolean;
}) {
  const key = useRef<string | null>(null);
  const sending = useRef(false);
  const [status, setStatus] = useState<"ready" | "sending" | "accepted" | "pending" | "error">("ready");
  const [message, setMessage] = useState("");
  async function dial() {
    if (sending.current || disabled) return;
    sending.current = true;
    key.current ??= crypto.randomUUID();
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/ops/voice-phone/placetel", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestKey: key.current, customerId, requestId, recordingConsent: true }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !["accepted", "pending"].includes(data.state)) {
        setStatus("error");
        setMessage(Array.isArray(data.issues) && typeof data.error === "string" ? data.error : "Wählauftrag unbestätigt. Bitte prüfe die Verbindung zu Placetel.");
        return;
      }
      setStatus(data.state);
      setMessage(data.state === "accepted" ? "Placetel hat den Wählauftrag angenommen. Nimm den Rückruf an deinem Telefon an." : "Wählauftrag übermittelt. Die Bestätigung von Placetel steht noch aus.");
    } catch {
      setStatus("error");
      setMessage("Die Antwort von Placetel fehlt. Prüfe die Telefon-App, bevor du den Status erneut abfragst.");
    } finally {
      sending.current = false;
    }
  }
  return <div>
    <button type="button" className={styles.button + " " + styles.primary}
      disabled={disabled || status === "sending" || status === "accepted"} onClick={() => void dial()}>
      <Phone size={17}/>{status === "sending" ? "Wählauftrag läuft …" : status === "accepted" ? "Wählauftrag angenommen" :
        status === "pending" || status === "error" ? "Wählauftrag prüfen" : "Mit Placetel anrufen"}
    </button>
    <p className={styles.small}>Mit dem Anruf bestätigst du die Einwilligung zur Aufzeichnung und Mitschrift.</p>
    {message && <p role="status" className={styles.small}>{message}</p>}
    {status === "accepted" && <button type="button" className={styles.link} onClick={() => {
      key.current = null; setStatus("ready"); setMessage("");
    }}>Weiteren Anruf vorbereiten</button>}
  </div>;
}
