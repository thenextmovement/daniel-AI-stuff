"use client";
import { useEffect, useRef, useState } from "react";
import type { CustomerOpsNote } from "@/lib/ops/customer-records";
import styles from "./phone-central.module.css";

export function CallNotes({ requestId }: { requestId: string }) {
  const [notes, setNotes] = useState<CustomerOpsNote[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ops/customer-records/notes?requestId=" + encodeURIComponent(requestId), { cache: "no-store", signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw Error();
        const data = await res.json();
        if (!controller.signal.aborted) setNotes(old => [...new Map<string, CustomerOpsNote>([...old, ...data.notes].map(note => [note.id, note])).values()]);
      })
      .catch(() => { if (!controller.signal.aborted) setError("Die gespeicherten Notizen konnten nicht geladen werden."); });
    return () => controller.abort();
  }, [requestId, retry]);
  async function save() {
    if (submitting.current || !draft.trim()) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ops/customer-records/notes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, note: draft.trim(), kind: "note" }),
      });
      if (!response.ok) throw Error();
      const { note } = await response.json();
      setNotes(old => [note, ...old.filter(n => n.id !== note.id)]);
      setDraft("");
    } catch {
      setError("Speichern unbestätigt. Bitte lade die Notizen vor einem weiteren Versuch erneut.");
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }
  return <section className={styles.prep} aria-label="Notizen zum Vorgang">
    <h3>Notizen zum Vorgang</h3>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <textarea aria-label="Gesprächsnotiz" placeholder="Was habt ihr besprochen?" rows={3}
        className={styles.callNoteInput} disabled={saving} value={draft} onChange={e => setDraft(e.target.value)} />
      <button className={styles.button} disabled={saving || !draft.trim()}>{saving ? "Speichert …" : "Notiz speichern"}</button>
    </form>
    {error && <p role="alert">{error} <button className={styles.link} onClick={() => { setError(""); setRetry(n => n + 1); }}>Notizen neu laden</button></p>}
    {notes.map(note => <article key={note.id} className={styles.callNote}>
      <small>{note.createdAt && new Date(note.createdAt).toLocaleString("de-DE")}</small>
      <p>{note.note}</p>
    </article>)}
  </section>;
}
