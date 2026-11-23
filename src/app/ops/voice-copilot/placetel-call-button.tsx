"use client";
import { useEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { Phone } from "lucide-react";
import styles from "./phone-central.module.css";

export type PlacetelCallHandle = { start: (number: string) => boolean };
export function PlacetelCallButton({ ref, customerId, requestId, dialNumber, disabled, onCallChange, onNoteTarget, onEnded, onStarted }: {
  onStarted?: (customerId:string,requestId:string,startedAt:string)=>void; onEnded?: (customerId:string,requestId:string,callId:string)=>void; ref?: Ref<PlacetelCallHandle>; customerId: string; requestId: string; dialNumber?:string; disabled: boolean; onCallChange: () => void; onNoteTarget: (callId:string) => void;
}) {
  const confirmation = useRef<HTMLDialogElement>(null);
  const key = useRef<string | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const [status, setStatus] = useState<"ready" | "sending" | "retry" | "prepared" | "opened" | "ended">("ready");
  const [message, setMessage] = useState("");
  const [callId, setCallId] = useState("");
  const [phone, setPhone] = useState("");
  const expires = useRef(0);
  const endedCallback=useRef(onEnded);endedCallback.current=onEnded;
  const binding=useRef({customerId,requestId});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!callId || status !== "opened") return;
    const controller = new AbortController();
    let timer: number;
    let checking = false;
    const check = async () => {
      if (checking || controller.signal.aborted) return;
      window.clearTimeout(timer);
      checking = true;
      try {
        const response = await fetch("/api/ops/voice-phone/placetel/status?callId=" + encodeURIComponent(callId), {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted && typeof data.endedAt === "string" && Number.isFinite(Date.parse(data.endedAt))) {
            setStatus("ended");
            setMessage("Gespräch beendet");
            endedCallback.current?.(binding.current.customerId,binding.current.requestId,callId);
            onCallChange();
            return;
          }
        }
      } catch {
        // Keep checking after transient connection errors or when returning to OPS.
      } finally {
        checking = false;
      }
      if (!controller.signal.aborted) timer = window.setTimeout(check, document.hidden ? 10000 : 2000);
    };
    const onReturn = () => { if (!document.hidden) void check(); };
    void check();
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [callId, status, onCallChange]);
  function open(number: string) {
    if (Date.now() >= expires.current) {
      setStatus("ended");
      setMessage("Die Vorbereitung ist abgelaufen. Bitte bereite den Anruf erneut vor.");
      return;
    }
    onStarted?.(binding.current.customerId,binding.current.requestId,new Date().toISOString());
    setStatus("opened");
    window.location.assign("tel:" + number);
    setMessage("Nummer an Placetel übergeben. Die Gesprächsdokumentation erscheint hier, sobald die Aufnahme vorliegt.");
  }
  const requestedNumber = useRef<string | undefined>(undefined);
  const [confirmationNumber, setConfirmationNumber] = useState("");
  useImperativeHandle(ref, () => ({ start(number) {
    if (disabled || sending.current || status === "opened" || status === "prepared" || status === "retry") return false;
    key.current = null; requestedNumber.current = number;
    setConfirmationNumber(number);
    confirmation.current?.showModal();
    return true;
  }}));
  async function prepare(number = requestedNumber.current || dialNumber) {
    if (sending.current || disabled) return;
    requestedNumber.current = number;
    sending.current = true;
    key.current ??= crypto.randomUUID();
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/ops/voice-phone/placetel", {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({mode:"softphone", requestKey:key.current, customerId, requestId, phone:number, recordingConsent:true}),
        signal:AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok || !data.ok) {
        setStatus(response.status === 409 ? "ended" : "retry");
        setMessage(typeof data.error === "string" ? data.error : "Der Anruf konnte nicht vorbereitet werden.");
        return;
      }
      if (typeof data.callId !== "string" || !data.callId || data.direct !== true || data.state !== "accepted" || !/^\+[1-9]\d{6,14}$/.test(data.dialedPhone ?? "") || !Number.isFinite(data.expiresAt)) {
        setStatus("retry");
        setMessage("Die Bestätigung für die Direktwahl steht aus.");
        return;
      }
      binding.current={customerId,requestId};
      setCallId(data.callId);
      onNoteTarget(data.callId);
      expires.current = data.expiresAt;
      setPhone(data.dialedPhone);
      onCallChange();
      if (navigator.userActivation?.isActive) open(data.dialedPhone);
      else {
        setStatus("prepared");
        setMessage("Der Vorgang ist zugeordnet. Öffne jetzt das Softphone.");
      }
    } catch {
      if (mounted.current) { setStatus("retry"); setMessage("Die Vorbereitung konnte nicht bestätigt werden. Bitte prüfe den Status."); }
    } finally { sending.current = false; }
  }
  return <div>
    <dialog ref={confirmation} className={styles.phoneDialog} aria-labelledby="confirm-placetel-title">
      <form onSubmit={event => {
        event.preventDefault();
        if (disabled || sending.current || !confirmation.current?.open) return;
        confirmation.current.close();
        if (status === "prepared") open(phone); else void prepare();
      }}>
        <h3 id="confirm-placetel-title">Anruf bestätigen</h3>
        <p>Möchtest du {confirmationNumber || phone || dialNumber || "diesen Kunden"} jetzt mit dem Placetel-Softphone anrufen?</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 24 }}>
          <button type="submit" className={styles.button + " " + styles.primary} style={{ minHeight: 64, fontSize: 20, justifyContent: "center" }} disabled={disabled || status === "sending"}><Phone size={22}/>Anrufen</button>
          <button type="button" className={styles.button} style={{ minHeight: 64, fontSize: 20, justifyContent: "center" }} autoFocus onClick={() => confirmation.current?.close()}>Abbrechen</button>
        </div>
      </form>
    </dialog>
    {status === "opened" ? <p role="status">Zum Auflegen oder Abbrechen den roten Hörer im Placetel-Softphone drücken.</p> :
      status !== "ended" && <button className={styles.button + " " + styles.primary + " " + styles.placetelDial} type="button" disabled={disabled || status === "sending"}
        onClick={() => { setConfirmationNumber(phone || requestedNumber.current || dialNumber || ""); confirmation.current?.showModal(); }}>
        <Phone size={17}/>{status === "sending" ? "Anruf wird vorbereitet …" : status === "retry" ? "Status prüfen" : status === "prepared" ? "Placetel-Softphone öffnen" : "Mit Placetel-Softphone anrufen"}
      </button>}
    {message && <p role="status" className={styles.small}>{message}</p>}
    {(status === "opened" || status === "ended") && <button type="button" className={styles.link} onClick={() => {
      key.current = null; requestedNumber.current = undefined; onNoteTarget(""); setCallId(""); setPhone(""); setStatus("ready"); setMessage("");
    }}>Weiteren Anruf vorbereiten</button>}
  </div>;
}
