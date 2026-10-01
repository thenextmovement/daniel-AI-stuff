"use client";
import { useEffect, useState } from "react";
import catalog from "@/lib/ops/social-studio/catalog.json";
import {
  CHANNELS,
  LABELS,
  LIMITS,
  FORMATS,
  validateTexts,
  type Channel,
  type Texts,
} from "@/lib/ops/social-studio/studio-contract";
import {
  stateNames,
  berlin,
  publicLink,
  type Draft,
} from "@/lib/ops/social-studio/studio-state";
async function api(action: string, data: object = {}) {
  const r = await fetch("/api/ops/social-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const j = (await r.json()) as any;
  if (!r.ok || j.error)
    throw new Error(
      j.error || "Speichern fehlgeschlagen. Bitte erneut öffnen.",
    );
  return j;
}
async function renderImage(file: string, width: number, height: number) {
  const img = new Image();
  img.src = "/ops/social-studio/originals/" + encodeURIComponent(file);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#111214";
  ctx.fillRect(0, 0, width, height);
  const k = Math.min(width / img.width, height / img.height);
  ctx.drawImage(
    img,
    (width - img.width * k) / 2,
    (height - img.height * k) / 2,
    img.width * k,
    img.height * k,
  );
  return c.toDataURL("image/jpeg", 0.92).split(",")[1];
}
function dateInBerlin(s: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(s));
  return ["year", "month", "day"]
    .map((k) => p.find((p) => p.type === k)?.value)
    .join("-");
}
function dateAt1130(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
    throw new Error("Bitte ein Datum auswählen.");
  const d = new Date(s + "T11:30:00Z");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d),
  );
  return new Date(d.getTime() - (hour - 11) * 3600000).toISOString();
}
export default function Studio() {
  const [tab, setTab] = useState("gallery"),
    [filter, setFilter] = useState("favorites"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [active, setActive] = useState(""),
    [channel, setChannel] = useState<Channel>("ig"),
    [texts, setTexts] = useState<Texts | null>(null),
    [revision, setRevision] = useState(0),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(false),
    [due, setDue] = useState<string | null>(null),
    [previewError, setPreviewError] = useState(""),
    [moveId, setMoveId] = useState(""),
    [moveDate, setMoveDate] = useState("");
  const draft = drafts.find((d) => d.id === active),
    item = catalog.find((c) => c.id === active),
    editable = draft?.status === "draft";
  async function refresh(check = false) {
    const j = await api("list", { refreshStatuses: check });
    setDrafts(j.drafts);
    setReady(true);
    return j.drafts as Draft[];
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!active || !editable) return;
    let live = true;
    setDue(null);
    setPreviewError("");
    api("preview", { id: active })
      .then((j) => {
        if (live) setDue(j.dueAt);
      })
      .catch((e) => {
        if (live) setPreviewError(e.message);
      });
    return () => {
      live = false;
    };
  }, [active, editable, revision]);
  function openDraft(d: Draft) {
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?"))
      return;
    setActive(d.id);
    setTexts(d.texts);
    setRevision(d.revision);
    setConfirm(false);
    setDirty(false);
    setTab("review");
    setError("");
    setNotice("");
  }
  function changeTab(t: string) {
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?"))
      return;
    if (dirty && draft) {
      setTexts(draft.texts);
      setRevision(draft.revision);
      setConfirm(false);
    }
    setDirty(false);
    setTab(t);
    setError("");
    setNotice("");
    if (["planned", "published", "issues"].includes(t))
      void run("Status wird geprüft", async () => {
        await refresh(true);
      });
  }
  async function run(task: string, fn: () => Promise<void>) {
    setBusy(task);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      try {
        await refresh();
      } catch {}
    } finally {
      setBusy("");
    }
  }
  async function generate() {
    await run("Texte werden erstellt", async () => {
      let first: Draft | null = null;
      try {
        for (const id of selected) {
          const c = catalog.find((c) => c.id === id)!;
          setBusy("Texte für " + c.name + " werden erstellt");
          const image = await renderImage(c.file, 768, 768);
          const j = await api("generate", { id, image });
          if (!first) first = j.draft;
          setSelected((s) => s.filter((i) => i !== id));
        }
      } finally {
        await refresh();
        if (first) openDraft(first);
      }
    });
  }
  async function save() {
    if (!draft || !texts) return;
    await run("Änderungen werden gespeichert", async () => {
      const j = await api("save", {
        id: draft.id,
        texts: validateTexts(texts),
        revision,
      });
      setRevision(j.draft.revision);
      setDirty(false);
      setConfirm(false);
      await refresh();
      setNotice("Änderungen gespeichert.");
    });
  }
  async function approve() {
    if (!draft || !item || !texts || !due || !confirm) return;
    await run("Beitrag wird freigegeben und eingeplant", async () => {
      let submitted: Texts | null = null;
      try {
        const clean = validateTexts(texts);
        submitted = clean;
        const images: Record<string, string> = {};
        for (const f of Object.values(FORMATS)) {
          if (!images[f.key])
            images[f.key] = await renderImage(item.file, f.width, f.height);
        }
        const j = await api("approve", {
          id: draft.id,
          texts: clean,
          revision,
          images,
          confirmed: true,
          expectedDueAt: due,
        });
        setDirty(false);
        await refresh();
        setTab(j.status === "scheduled" ? "planned" : "issues");
        setNotice(
          j.status === "scheduled"
            ? "Der Beitrag ist für " +
                berlin(j.draft.due_at) +
                " Uhr eingeplant."
            : "Freigabe gespeichert. Bitte den Status der Plattformen prüfen.",
        );
      } finally {
        setConfirm(false);
        const fresh = (await refresh()).find((d) => d.id === active);
        if (
          fresh &&
          (fresh.status !== "draft" ||
            (submitted &&
              JSON.stringify(fresh.texts) === JSON.stringify(submitted)))
        ) {
          setRevision(fresh.revision);
          setTexts(fresh.texts);
          setDirty(false);
        }
      }
    });
  }
  async function withdraw(d: Draft) {
    if (
      !window.confirm(
        "Freigabe zurückziehen? Alle noch nicht veröffentlichten Plattformbeiträge werden bei Buffer zu Entwürfen. Bereits veröffentlichte Beiträge bleiben bestehen.",
      )
    )
      return;
    await run("Freigabe wird zurückgezogen", async () => {
      const j = await api("withdraw", {
        id: d.id,
        revision: d.revision,
        confirmed: true,
      });
      await refresh();
      if (j.status === "draft") {
        openDraft(j.draft);
        setNotice(
          "Freigabe zurückgezogen. Du kannst die Texte bearbeiten und erneut freigeben.",
        );
      } else {
        setTab("issues");
        setNotice(
          "Die Freigabe ist noch nicht vollständig zurückgezogen. Bitte die Plattformen prüfen.",
        );
      }
    });
  }
  async function move(d: Draft) {
    await run("Termin wird geändert", async () => {
      const dueAt = dateAt1130(moveDate);
      const j = await api("reschedule", {
        id: d.id,
        revision: d.revision,
        dueAt,
        confirmed: true,
      });
      await refresh();
      setMoveId("");
      setTab(j.status === "scheduled" ? "planned" : "issues");
      setNotice(
        j.status === "scheduled"
          ? "Neuer Termin: " + berlin(dueAt) + " Uhr."
          : "Die Terminänderung ist noch nicht auf allen Plattformen bestätigt.",
      );
    });
  }
  const isPlanned = (d: Draft) =>
    [
      "preparing",
      "scheduling",
      "rescheduling",
      "withdrawing",
      "scheduled",
      "sending",
    ].includes(d.status);
  const isIssue = (d: Draft) =>
    d.status !== "draft" && d.status !== "sent" && !isPlanned(d);
  const visible = catalog.filter(
    (c) =>
      (filter !== "favorites" || c.favorite) &&
      (!search || c.name.toLowerCase().includes(search.toLowerCase())),
  );
  const shown = drafts
    .filter((d) =>
      tab === "planned"
        ? isPlanned(d)
        : tab === "published"
          ? d.status === "sent"
          : isIssue(d),
    )
    .sort((a, b) => (a.due_at || "").localeCompare(b.due_at || ""));
  const counts = {
    review: drafts.filter((d) => d.status === "draft").length,
    planned: drafts.filter(isPlanned).length,
    published: drafts.filter((d) => d.status === "sent").length,
    issues: drafts.filter(isIssue).length,
  };
  return (
    <div className="ops-social-studio">
      <div className="studio-heading">
        <strong>Social Studio</strong>
        <span className="small">
          Ein Motiv alle 3 Tage · 11:30 Uhr · Berlin
        </span>
      </div>
      <nav className="tabs" aria-label="Arbeitsbereich">
        {[
          ["gallery", "Bilder auswählen"],
          ["review", "Entwürfe"],
          ["planned", "Geplante Beiträge"],
          ["published", "Veröffentlicht"],
          ["issues", "Bitte prüfen"],
        ].map(([t, label]) => (
          <button
            key={t}
            disabled={!!busy}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => changeTab(t)}
          >
            {label}
            {t !== "gallery" && (
              <span className="nav-count">
                {counts[t as keyof typeof counts]}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="workspace">
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {busy && (
          <div role="status" className="loading">
            {busy}…
          </div>
        )}
        {tab === "gallery" && (
          <>
            <div className="section-heading">
              <div>
                <h1>Bilder auswählen</h1>
                <p className="muted">
                  Motive markieren, Texte vorbereiten und vor der
                  Veröffentlichung prüfen.
                </p>
              </div>
              <span className="collection-note">
                {catalog.length} Motive aus deiner Sammlung
              </span>
            </div>
            <div className="toolbar">
              <input
                type="search"
                placeholder="Motiv suchen"
                aria-label="Motiv suchen"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Auswahl filtern"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="favorites">90 Favoriten</option>
                <option value="all">Alle 201 Motive</option>
              </select>
              <span className="count muted">{visible.length} Motive</span>
            </div>
            <div className="gallery">
              {visible.map((c) => {
                const d = drafts.find((d) => d.id === c.id),
                  locked = d && d.status !== "draft";
                return (
                  <article
                    key={c.file}
                    className={
                      "card" + (selected.includes(c.id) ? " selected" : "")
                    }
                  >
                    <button
                      className="image-button"
                      aria-label={c.name + " auswählen"}
                      aria-pressed={selected.includes(c.id)}
                      disabled={!!locked || !!busy || !ready}
                      onClick={() =>
                        setSelected((s) =>
                          s.includes(c.id)
                            ? s.filter((i) => i !== c.id)
                            : [...s, c.id],
                        )
                      }
                    >
                      <img
                        src={
                          "/ops/social-studio/thumbs/" +
                          encodeURIComponent(c.file.replace(/\.png$/i, ".jpg"))
                        }
                        alt={"KI-Visualisierung: " + c.name}
                        loading="lazy"
                      />
                      <span className="check" aria-hidden="true">
                        {selected.includes(c.id) && (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        )}
                      </span>
                    </button>
                    <div className="meta">
                      <span className="badge">
                        {d
                          ? stateNames[d.status] || "Bitte prüfen"
                          : c.favorite
                            ? "Favorit"
                            : "Weitere Variante"}
                      </span>
                      <h2>{c.name}</h2>
                      <div className="card-links">
                        <a
                          href={c.trello}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Trello-Karte
                        </a>
                        {d && (
                          <button
                            className="text-action"
                            disabled={!!busy}
                            onClick={() => openDraft(d)}
                          >
                            Beitrag öffnen
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {selected.length > 0 && (
              <div className="selection-bar">
                <strong>
                  {selected.length} {selected.length === 1 ? "Motiv" : "Motive"}{" "}
                  ausgewählt
                </strong>
                <button
                  className="primary"
                  onClick={generate}
                  disabled={!!busy}
                >
                  Texte vorbereiten <Arrow />
                </button>
              </div>
            )}
          </>
        )}
        {tab === "review" && (
          <>
            <h1>Entwürfe</h1>
            <p className="muted">
              Text und Bildformat für jede Plattform prüfen. Erst deine Freigabe
              plant den Beitrag ein.
            </p>
            <div className="draft-nav">
              {drafts
                .filter((d) => d.status === "draft")
                .map((d) => (
                  <button
                    disabled={!!busy}
                    className={d.id === active ? "active" : ""}
                    key={d.id}
                    onClick={() => openDraft(d)}
                  >
                    {catalog.find((c) => c.id === d.id)?.name}
                  </button>
                ))}
            </div>
            {!draft || !texts || !item ? (
              <div className="empty">
                <h2>Noch kein Entwurf geöffnet</h2>
                <p>
                  Wähle oben einen Entwurf oder bereite Texte zu einem Bild vor.
                </p>
                <button onClick={() => changeTab("gallery")}>
                  Bilder auswählen
                </button>
              </div>
            ) : (
              <div className="editor">
                <aside className="editor-side">
                  <img
                    className="preview"
                    style={
                      {
                        "--ratio":
                          FORMATS[channel].width +
                          "/" +
                          FORMATS[channel].height,
                      } as React.CSSProperties
                    }
                    src={
                      "/ops/social-studio/originals/" +
                      encodeURIComponent(item.file)
                    }
                    alt={"Formatvorschau " + LABELS[channel] + ": " + item.name}
                  />
                  <h2>{item.name}</h2>
                  <p className="muted small">
                    {LABELS[channel]} · {FORMATS[channel].width} ×{" "}
                    {FORMATS[channel].height} px
                    <br />
                    KI-Visualisierung
                  </p>
                  <a
                    className="small"
                    href={
                      "/ops/social-studio/originals/" +
                      encodeURIComponent(item.file)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Originalbild ansehen
                  </a>
                  {draft.approved_at && (
                    <p className="muted small">
                      Letzte Freigabe: {berlin(draft.approved_at)}
                      <br />
                      {draft.approved_by}
                    </p>
                  )}
                </aside>
                <section>
                  <div
                    className="text-tabs"
                    role="group"
                    aria-label="Plattform"
                  >
                    {CHANNELS.map((c) => (
                      <button
                        key={c}
                        className={channel === c ? "active" : ""}
                        onClick={() => setChannel(c)}
                      >
                        {LABELS[c]}
                      </button>
                    ))}
                  </div>
                  {channel === "pinterest" && (
                    <>
                      <label htmlFor="pin-title">Pinterest-Titel</label>
                      <input
                        id="pin-title"
                        className="title"
                        maxLength={100}
                        value={texts.pinterestTitle}
                        disabled={!editable || !!busy}
                        onChange={(e) => {
                          setTexts({
                            ...texts,
                            pinterestTitle: e.target.value,
                          });
                          setDirty(true);
                          setConfirm(false);
                        }}
                      />
                    </>
                  )}
                  <label htmlFor="post-text">Text für {LABELS[channel]}</label>
                  <textarea
                    id="post-text"
                    value={texts[channel]}
                    disabled={!editable || !!busy}
                    onChange={(e) => {
                      setTexts({ ...texts, [channel]: e.target.value });
                      setDirty(true);
                      setConfirm(false);
                    }}
                  />
                  <div className="text-meta">
                    <span>
                      {texts[channel].length} / {LIMITS[channel]} Zeichen
                    </span>
                    <span>
                      {stateNames[draft.status] || "Bitte prüfen"}
                      {dirty ? " · Ungespeicherte Änderungen" : ""}
                    </span>
                  </div>
                  {editable ? (
                    <>
                      <div className="slot-preview">
                        <span>Nächster freier Termin</span>
                        <strong>
                          {due
                            ? berlin(due) + " Uhr"
                            : previewError
                              ? "Termin nicht verfügbar"
                              : "Termin wird geprüft…"}
                        </strong>
                        <span className="small muted">
                          Europe/Berlin · alle fünf Plattformen · vorläufig bis
                          zur Freigabe
                        </span>
                        {previewError && <p role="alert">{previewError}</p>}
                      </div>
                      <label className="confirmation">
                        <input
                          type="checkbox"
                          checked={confirm}
                          disabled={!!busy || !due}
                          onChange={(e) => setConfirm(e.target.checked)}
                        />
                        <span>
                          Ich habe alle fünf Plattformtexte und Bildformate
                          geprüft und gebe dieses Motiv für den angezeigten
                          Termin frei.
                        </span>
                      </label>
                      <div className="actions">
                        <button onClick={save} disabled={!!busy || !dirty}>
                          Änderungen speichern
                        </button>
                        <button
                          className="primary"
                          onClick={approve}
                          disabled={!!busy || !confirm || !due}
                        >
                          Freigeben und einplanen <Arrow />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="muted">
                        Freigegeben für {berlin(draft.due_at)} Uhr.
                      </p>
                      <button
                        onClick={() =>
                          changeTab(
                            draft.status === "sent"
                              ? "published"
                              : isIssue(draft)
                                ? "issues"
                                : "planned",
                          )
                        }
                      >
                        Status und Termin ansehen
                      </button>
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
        {["planned", "published", "issues"].includes(tab) && (
          <>
            <div className="section-heading">
              <div>
                <h1>
                  {tab === "planned"
                    ? "Geplante Beiträge"
                    : tab === "published"
                      ? "Veröffentlicht"
                      : "Bitte prüfen"}
                </h1>
                <p className="muted">
                  {tab === "planned"
                    ? "Freigegebene Motive mit Termin und Status je Plattform."
                    : tab === "published"
                      ? "Von Buffer bestätigte Veröffentlichungen mit Beitragslinks."
                      : "Unvollständige Veröffentlichungen und Änderungen. Prüfe zuerst den aktuellen Status."}
                </p>
              </div>
              <button
                disabled={!!busy}
                onClick={() =>
                  run("Status wird geprüft", async () => {
                    await refresh(true);
                  })
                }
              >
                Status aktualisieren
              </button>
            </div>
            <div className="queue">
              {shown.map((d) => {
                const c = catalog.find((c) => c.id === d.id)!;
                const locked = [
                  "preparing",
                  "scheduling",
                  "rescheduling",
                  "withdrawing",
                ].includes(d.status);
                const actionable = !locked && d.status !== "sent";
                return (
                  <article className="queue-card" key={d.id}>
                    <img
                      src={
                        "/ops/social-studio/thumbs/" +
                        encodeURIComponent(c.file.replace(/\.png$/i, ".jpg"))
                      }
                      alt={c.name}
                    />
                    <div>
                      <div className="post-heading">
                        <h2>{c.name}</h2>
                        <span className={"status status-" + d.status}>
                          {stateNames[d.status] || "Bitte prüfen"}
                        </span>
                      </div>
                      <strong className="due">
                        {d.due_at
                          ? berlin(d.due_at) + " Uhr"
                          : "Termin wird vorbereitet"}
                      </strong>
                      <p className="muted small">
                        Freigegeben von {d.approved_by || "–"}
                        {d.approved_at ? " · " + berlin(d.approved_at) : ""}
                      </p>
                      <div className="channels">
                        {CHANNELS.map((ch) => {
                          const r = d.deliveries.find((r) => r.channel === ch);
                          const link = publicLink(r?.external_link);
                          return (
                            <div className="channel-state" key={ch}>
                              <strong>{LABELS[ch]}</strong>
                              <span>
                                {r
                                  ? stateNames[r.status] || "Bitte prüfen"
                                  : "Noch nicht bestätigt"}
                              </span>
                              {r?.status === "sent" ? (
                                <span>
                                  {r.sent_at
                                    ? berlin(r.sent_at) + " Uhr"
                                    : "Veröffentlichungszeit noch nicht bestätigt"}
                                </span>
                              ) : (
                                r?.due_at && (
                                  <span>{berlin(r.due_at) + " Uhr"}</span>
                                )
                              )}
                              <span className="small muted">
                                {r?.checked_at
                                  ? "Geprüft: " + berlin(r.checked_at)
                                  : "Noch nicht geprüft"}
                              </span>
                              {r?.error && (
                                <span className="channel-error">{r.error}</span>
                              )}
                              {link && r?.status === "sent" && (
                                <a
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Beitrag ansehen
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {d.status === "manual_review" && (
                        <p className="small muted">
                          Bei unbekanntem Ergebnis zuerst{" "}
                          <a
                            href="https://publish.buffer.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Buffer öffnen
                          </a>
                          . Beiträge ohne bestätigte ID werden nicht erneut
                          versendet. Ein bereits veröffentlichter Beitrag bleibt
                          online.
                        </p>
                      )}
                      <div className="actions">
                        <button disabled={!!busy} onClick={() => openDraft(d)}>
                          Texte ansehen
                        </button>
                        {actionable && (
                          <>
                            <button
                              disabled={
                                !!busy ||
                                d.deliveries.some(
                                  (r) =>
                                    r.status === "sent" ||
                                    r.status === "sending" ||
                                    !r.buffer_id,
                                )
                              }
                              onClick={() => {
                                setMoveId(d.id);
                                setMoveDate(
                                  d.due_at
                                    ? dateInBerlin(d.due_at)
                                    : dateInBerlin(new Date().toISOString()),
                                );
                              }}
                            >
                              {d.status === "manual_review"
                                ? "Termin bestätigen / erneut planen"
                                : "Termin ändern"}
                            </button>
                            <button
                              disabled={!!busy}
                              onClick={() => withdraw(d)}
                            >
                              Freigabe zurückziehen
                            </button>
                          </>
                        )}
                      </div>
                      {moveId === d.id && (
                        <form
                          className="move-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void move(d);
                          }}
                        >
                          <label htmlFor={"move-" + d.id}>
                            Neues Datum · 11:30 Uhr Berlin
                          </label>
                          <input
                            id={"move-" + d.id}
                            type="date"
                            required
                            min={dateInBerlin(new Date().toISOString())}
                            value={moveDate}
                            onChange={(e) => setMoveDate(e.target.value)}
                          />
                          <p className="small muted">
                            Mindestens drei Kalendertage Abstand zu anderen
                            Motiven. Deren Termine bleiben bestehen.
                          </p>
                          <div className="actions">
                            <button
                              type="submit"
                              className="primary"
                              disabled={!!busy}
                            >
                              Neuen Termin bestätigen
                            </button>
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => setMoveId("")}
                            >
                              Abbrechen
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </article>
                );
              })}
              {shown.length === 0 && (
                <div className="empty">
                  <h2>
                    {tab === "planned"
                      ? "Noch keine Beiträge geplant"
                      : tab === "published"
                        ? "Noch keine bestätigten Veröffentlichungen"
                        : "Keine Beiträge zu prüfen"}
                  </h2>
                  <p>
                    {tab === "planned"
                      ? "Gib einen geprüften Entwurf frei. Der Termin wird dir vorher angezeigt."
                      : tab === "published"
                        ? "Nach der Veröffentlichung erscheinen hier Zeitpunkt und Beitragslink je Plattform."
                        : "Unvollständige Freigaben und Fehler erscheinen hier."}
                  </p>
                  {tab === "planned" && (
                    <button onClick={() => changeTab("review")}>
                      Entwürfe öffnen
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function Arrow() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </svg>
  );
}
