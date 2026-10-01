import { isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import catalog from "@/lib/ops/social-studio/catalog.json";
import {
  CHANNELS,
  FORMATS,
  validateTexts,
  type Texts,
} from "@/lib/ops/social-studio/studio-contract";
export const dynamic = "force-dynamic";
import {
  providerState,
  overallState,
  publicLink,
  type Delivery,
} from "@/lib/ops/social-studio/studio-state";
type Row = {
  id: string;
  texts: string;
  revision: number;
  status: string;
  due_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
};
async function gateway(action: string, data: Record<string, unknown> = {}) {
  const e = process.env;
  if (!e.STUDIO_GATEWAY_URL || !e.STUDIO_GATEWAY_KEY)
    throw new Error(
      "Die Verbindung zur Veröffentlichung ist noch nicht eingerichtet.",
    );
  const r = await fetch(e.STUDIO_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Neontrip-Studio-Key": e.STUDIO_GATEWAY_KEY,
    },
    body: JSON.stringify({ action, ...data }),
    signal: AbortSignal.timeout(140000),
  });
  if (!r.ok) throw new Error("Die Verbindung zur Automation ist unterbrochen.");
  const j = (await r.json()) as any;
  if (!j.ok)
    throw new Error(
      j.error || "Die Automation konnte den Schritt nicht bestätigen.",
    );
  return j;
}
const now = () => new Date().toISOString();
async function row(id: string) {
  return (
    (
      await supabaseRequest<Row[]>("neontrip_social_drafts", undefined, {
        select: "*",
        id: `eq.${id}`,
        limit: 1,
      })
    )[0] || null
  );
}
async function deliveries(id: string) {
  return await supabaseRequest<Delivery[]>(
    "neontrip_social_deliveries",
    undefined,
    { select: "*", draft_id: `eq.${id}`, limit: 5 },
  );
}
async function patchDraft(
  id: string,
  values: Partial<Row>,
  conditions: Record<string, string | number> = {},
) {
  return supabaseRequest<Row[]>(
    "neontrip_social_drafts",
    {
      method: "PATCH",
      body: JSON.stringify(values),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${id}`, ...conditions },
  );
}
async function patchDelivery(
  id: string,
  channel: string,
  values: Partial<Delivery>,
  conditions: Record<string, string | number> = {},
) {
  return supabaseRequest<Delivery[]>(
    "neontrip_social_deliveries",
    {
      method: "PATCH",
      body: JSON.stringify(values),
      headers: { Prefer: "return=representation" },
    },
    { draft_id: `eq.${id}`, channel: `eq.${channel}`, ...conditions },
  );
}
async function list() {
  const rows = await supabaseRequest<Row[]>(
    "neontrip_social_drafts",
    undefined,
    { select: "*", order: "updated_at.desc", limit: catalog.length },
  );
  const ds: Delivery[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    ds.push(
      ...(await supabaseRequest<Delivery[]>(
        "neontrip_social_deliveries",
        undefined,
        {
          select: "*",
          draft_id: `in.(${rows
            .slice(i, i + 50)
            .map((r) => r.id)
            .join(",")})`,
          limit: 250,
        },
      )),
    );
  }
  return rows.map((r) => ({
    ...r,
    texts: JSON.parse(r.texts),
    deliveries: ds.filter((d) => d.draft_id === r.id),
  }));
}
async function draftResult(id: string) {
  const r = await row(id);
  return r
    ? { ...r, texts: JSON.parse(r.texts), deliveries: await deliveries(id) }
    : null;
}
function imageValid(s: unknown) {
  return (
    typeof s === "string" &&
    s.length > 100 &&
    s.length < 5000000 &&
    /^[A-Za-z0-9+/=]+$/.test(s) &&
    s.startsWith("/9j/")
  );
}
function future(s: unknown) {
  if (
    typeof s !== "string" ||
    !Number.isFinite(Date.parse(s)) ||
    Date.parse(s) <= Date.now() + 600000
  )
    throw new Error(
      "Bitte einen Termin mit mindestens zehn Minuten Vorlauf wählen.",
    );
  return new Date(s).toISOString();
}
async function recordPost(id: string, c: string, p: any) {
  if (!p?.id) throw new Error("Buffer-Ergebnis unklar.");
  const status = providerState(p.status);
  await patchDelivery(id, c, {
    status,
    buffer_id: p.id,
    due_at: p.dueAt || null,
    checked_at: now(),
    sent_at: p.sentAt || null,
    external_link: publicLink(p.externalLink),
    error:
      status === "failed"
        ? "Buffer meldet einen Fehler."
        : status === "manual_review"
          ? "Buffer-Status ist noch unklar."
          : null,
    updated_at: now(),
  });
}
async function mark(
  id: string,
  status: string,
  rs: Delivery[],
  oldDue?: string | null,
) {
  await gateway("mark", {
    id,
    status,
    ids: Object.fromEntries(
      rs.filter((r) => r.buffer_id).map((r) => [r.channel, r.buffer_id]),
    ),
    previousDueAt: oldDue,
  });
}
async function finish(id: string) {
  const rs = await deliveries(id);
  let status = rs.some((r) => r.error) ? "manual_review" : overallState(rs);
  const d = (await row(id))!;
  if (
    ["scheduled", "sending"].includes(status) &&
    rs.some((r) => r.status === "scheduled" && r.due_at !== d.due_at)
  )
    status = "manual_review";
  await patchDraft(id, { status, updated_at: now() });
  try {
    await mark(
      id,
      ["scheduled", "sending", "sent"].includes(status)
        ? "scheduled"
        : "partial_failed",
      rs,
      rs.find((r) => r.status === "scheduled" && r.due_at !== d.due_at)?.due_at,
    );
  } catch {
    await patchDraft(id, { status: "manual_review" });
    status = "manual_review";
  }
  return status;
}
async function reconcile(id: string) {
  const d = (await row(id))!;
  if (
    ["preparing", "scheduling", "rescheduling", "withdrawing"].includes(
      d.status,
    ) &&
    Date.parse(d.updated_at) > Date.now() - 1800000
  )
    return;
  for (const r of await deliveries(id)) {
    if (!r.buffer_id) continue;
    try {
      const j = await gateway("status", { bufferId: r.buffer_id });
      if (!j.data?.post?.id)
        throw new Error(
          "Beitrag bei Buffer nicht gefunden. Bitte direkt dort prüfen.",
        );
      await recordPost(id, r.channel, j.data.post);
    } catch (e) {
      await patchDelivery(id, r.channel, { error: (e as Error).message });
    }
  }
  if (d.status === "draft") return;
  const rs = await deliveries(id);
  const previous = await row(id);
  if (
    previous?.status === "withdrawing" &&
    rs.length === 5 &&
    rs.every((r) => r.status === "draft_buffer")
  ) {
    await mark(id, "cancelled", rs);
    await patchDraft(
      id,
      {
        status: "draft",
        due_at: null,
        revision: previous.revision + 1,
        updated_at: now(),
      },
      { revision: `eq.${previous.revision}`, status: "eq.withdrawing" },
    );
    return;
  }
  await finish(id);
}
async function schedule(d: Row, texts: Texts) {
  for (const r of await deliveries(d.id)) {
    if (r.status !== "pending" || !r.image_url) continue;
    const claim = await patchDelivery(
      d.id,
      r.channel,
      { status: "inflight", updated_at: now() },
      { status: "eq.pending" },
    );
    if (!claim.length) continue;
    try {
      const j = await gateway(r.buffer_id ? "edit" : "publish", {
        id: d.id,
        bufferId: r.buffer_id,
        channel: r.channel,
        text: texts[r.channel],
        pinterestTitle: texts.pinterestTitle,
        imageUrl: r.image_url,
        dueAt: d.due_at,
        operation: "schedule",
      });
      if (r.buffer_id && j.post?.id !== r.buffer_id)
        throw new Error("Buffer-ID wurde nicht bestätigt.");
      await recordPost(d.id, r.channel, j.post);
    } catch {
      await patchDelivery(d.id, r.channel, {
        status: "manual_review",
        error: "Ergebnis unklar. Vor einem erneuten Versand in Buffer prüfen.",
        updated_at: now(),
      });
    }
  }
  return finish(d.id);
}
export async function POST(req: Request) {
  try {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (!isOpsPortalConfigured(host))
      return Response.json(
        { error: "Ops-Zugang nicht eingerichtet." },
        { status: 503 },
      );
    const actor = await resolveOpsRequestActor(host, req.headers);
    if (!actor)
      return Response.json(
        { error: "Bitte in Ops anmelden." },
        { status: 401 },
      );
    const origin = req.headers.get("origin");
    // Next's internal request URL can use a different hostname behind Coolify.
    // Validate the browser origin against the public host, including its port.
    const publicProtocol =
      req.headers.get("x-forwarded-proto") ||
      new URL(req.url).protocol.replace(":", "");
    if (origin && origin !== `${publicProtocol}://${host}`)
      return Response.json({ error: "Ungültiger Ursprung." }, { status: 403 });
    const b = (await req.json()) as any;
    if (
      !b ||
      typeof b !== "object" ||
      ![
        "list",
        "preview",
        "generate",
        "save",
        "reconcile",
        "approve",
        "withdraw",
        "reschedule",
      ].includes(b.action)
    )
      return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
    if (
      ["save", "approve", "withdraw", "reschedule"].includes(b.action) &&
      (!Number.isSafeInteger(b.revision) || b.revision < 1)
    )
      return Response.json(
        { error: "Entwurf erneut öffnen." },
        { status: 400 },
      );
    if (b.action === "list") {
      if (b.refreshStatuses === true) {
        const rows = await list();
        for (const d of rows
          .filter((d) => d.status !== "draft" && d.status !== "sent")
          .slice(0, 20))
          await reconcile(d.id);
      }
      return Response.json({ drafts: await list() });
    }
    const asset = catalog.find((a) => a.id === b.id);
    if (!asset)
      return Response.json({ error: "Unbekanntes Motiv." }, { status: 400 });
    let d = await row(asset.id);
    if (b.action === "preview") {
      const j = await gateway("preview", { id: asset.id, name: asset.name });
      return Response.json({ dueAt: j.slot?.scheduled_at });
    }
    if (b.action === "generate") {
      if (d) return Response.json({ draft: await draftResult(asset.id) });
      if (!imageValid(b.image))
        throw new Error("Bild konnte nicht vorbereitet werden.");
      const j = await gateway("generate", {
        id: asset.id,
        name: asset.name,
        image: b.image,
      });
      const texts = validateTexts(j.texts);
      await supabaseRequest(
        "neontrip_social_drafts",
        {
          method: "POST",
          body: JSON.stringify({
            id: asset.id,
            texts: JSON.stringify(texts),
            revision: 1,
            status: "draft",
            updated_at: now(),
          }),
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        },
        { on_conflict: "id" },
      );
      return Response.json({ draft: await draftResult(asset.id) });
    }
    if (!d) throw new Error("Bitte zuerst Texte vorbereiten.");
    if (b.action === "save") {
      const texts = validateTexts(b.texts);
      const r = await patchDraft(
        asset.id,
        {
          texts: JSON.stringify(texts),
          revision: b.revision + 1,
          updated_at: now(),
        },
        { revision: `eq.${b.revision}`, status: "eq.draft" },
      );
      if (!r.length)
        return Response.json(
          {
            error:
              "Der Beitrag wurde zwischenzeitlich geändert. Bitte neu öffnen.",
          },
          { status: 409 },
        );
      return Response.json({ draft: await draftResult(asset.id) });
    }
    if (b.action === "reconcile") {
      await reconcile(asset.id);
      return Response.json({ draft: await draftResult(asset.id) });
    }
    if (b.action === "approve") {
      if (b.confirmed !== true)
        throw new Error("Bitte die Veröffentlichung ausdrücklich freigeben.");
      if (d.status !== "draft")
        return Response.json({
          status: d.status,
          draft: await draftResult(asset.id),
        });
      const expected = future(b.expectedDueAt),
        texts = validateTexts(b.texts);
      for (const key of ["portrait", "landscape", "pin"])
        if (!imageValid(b.images?.[key]))
          throw new Error("Die Formatbilder fehlen.");
      const existing = await deliveries(asset.id);
      if (existing.length) {
        await reconcile(asset.id);
        if (
          existing.length !== 5 ||
          (await deliveries(asset.id)).some(
            (r) => !r.buffer_id || r.status !== "draft_buffer" || r.error,
          )
        )
          throw new Error(
            "Vor einer erneuten Freigabe müssen alle fünf Buffer-Beiträge als Entwurf bestätigt sein.",
          );
      }
      const claim = await patchDraft(
        asset.id,
        {
          texts: JSON.stringify(texts),
          revision: b.revision + 1,
          status: "preparing",
          updated_at: now(),
        },
        { revision: `eq.${b.revision}`, status: "eq.draft" },
      );
      if (!claim.length)
        return Response.json(
          {
            error:
              "Der Beitrag wurde zwischenzeitlich geändert. Bitte neu öffnen.",
          },
          { status: 409 },
        );
      let reserved = false;
      try {
        const j = await gateway("reserve", {
          id: asset.id,
          name: asset.name,
          expectedDueAt: expected,
        });
        if (j.slot?.status === "changed") {
          await patchDraft(asset.id, { status: "draft", updated_at: now() });
          return Response.json(
            {
              error:
                "Der freie Termin hat sich geändert. Bitte den neuen Termin prüfen und erneut freigeben.",
              dueAt: j.slot.scheduled_at,
            },
            { status: 409 },
          );
        }
        const due = future(j.slot?.scheduled_at);
        reserved = true;
        await patchDraft(asset.id, {
          due_at: due,
          approved_by: actor,
          approved_at: now(),
        });
        const urls: Record<string, string> = {};
        if (!existing.length)
          for (const key of ["portrait", "landscape", "pin"])
            urls[key] = (
              await gateway("upload", {
                id: asset.id,
                format: key,
                image: b.images[key],
              })
            ).imageUrl;
        if (existing.length) {
          await supabaseRequest(
            "neontrip_social_deliveries",
            {
              method: "PATCH",
              body: JSON.stringify({
                status: "pending",
                error: null,
                updated_at: now(),
              }),
            },
            { draft_id: `eq.${asset.id}` },
          );
        } else {
          await supabaseRequest(
            "neontrip_social_deliveries",
            {
              method: "POST",
              body: JSON.stringify(
                CHANNELS.map((channel) => ({
                  draft_id: asset.id,
                  channel,
                  status: "pending",
                  image_url: urls[FORMATS[channel].key],
                  updated_at: now(),
                })),
              ),
              headers: {
                Prefer: "resolution=ignore-duplicates,return=minimal",
              },
            },
            { on_conflict: "draft_id,channel" },
          );
        }
        await patchDraft(asset.id, { status: "scheduling", updated_at: now() });
        d = (await row(asset.id))!;
        const status = await schedule(d, texts);
        return Response.json({ status, draft: await draftResult(asset.id) });
      } catch (e) {
        await patchDraft(asset.id, {
          status: reserved ? "manual_review" : "draft",
          updated_at: now(),
        });
        throw e;
      }
    }
    if (["withdraw", "reschedule"].includes(b.action)) {
      if (b.confirmed !== true)
        throw new Error("Bitte die Änderung ausdrücklich bestätigen.");
      await reconcile(asset.id);
      d = (await row(asset.id))!;
      if (
        [
          "draft",
          "preparing",
          "scheduling",
          "rescheduling",
          "withdrawing",
          "sent",
        ].includes(d.status)
      )
        throw new Error("Diese Aktion ist im aktuellen Status nicht möglich.");
      if (d.revision !== b.revision)
        throw new Error(
          "Der Beitrag wurde zwischenzeitlich geändert. Bitte neu öffnen.",
        );
      const rs = await deliveries(asset.id);
      if (b.action === "withdraw" && rs.length === 0) {
        const claim = await patchDraft(
          asset.id,
          {
            status: "withdrawing",
            revision: d.revision + 1,
            updated_at: now(),
          },
          { revision: `eq.${d.revision}`, status: `eq.${d.status}` },
        );
        if (!claim.length)
          throw new Error("Der Beitrag wird bereits geändert.");
        try {
          await mark(asset.id, "cancelled", rs);
          await patchDraft(asset.id, {
            status: "draft",
            due_at: null,
            updated_at: now(),
          });
          return Response.json({
            status: "draft",
            draft: await draftResult(asset.id),
          });
        } catch (e) {
          await patchDraft(asset.id, {
            status: "manual_review",
            updated_at: now(),
          });
          throw e;
        }
      }
      if (
        rs.length !== 5 ||
        rs.some(
          (r) =>
            !r.buffer_id ||
            (r.error && r.status !== "failed") ||
            ["inflight", "manual_review", "pending", "sending"].includes(
              r.status,
            ),
        )
      )
        throw new Error(
          "Erst den Status aller fünf Plattformen klären. Unbekannte Ergebnisse werden nicht erneut versendet.",
        );
      if (b.action === "reschedule" && rs.some((r) => r.status === "sent"))
        throw new Error(
          "Bereits veröffentlichte Beiträge können nicht verschoben werden.",
        );
      const due = b.action === "reschedule" ? future(b.dueAt) : null;
      const operation =
        b.action === "withdraw" ? "withdrawing" : "rescheduling";
      const claim = await patchDraft(
        asset.id,
        { status: operation, revision: d.revision + 1, updated_at: now() },
        { revision: `eq.${d.revision}`, status: `eq.${d.status}` },
      );
      if (!claim.length)
        throw new Error(
          "Der Beitrag wird bereits geändert. Bitte erneut öffnen.",
        );
      let moved = false;
      try {
        if (due) {
          await gateway("reschedule", {
            id: asset.id,
            name: asset.name,
            dueAt: due,
          });
          moved = true;
          await patchDraft(asset.id, { due_at: due });
        }
        for (const r of rs) {
          if (
            r.status === "sent" ||
            (b.action === "withdraw" && r.status === "draft_buffer")
          )
            continue;
          await patchDelivery(asset.id, r.channel, {
            status: "inflight",
            updated_at: now(),
          });
          try {
            const j = await gateway("edit", {
              id: asset.id,
              bufferId: r.buffer_id,
              channel: r.channel,
              operation: b.action === "withdraw" ? "withdraw" : "schedule",
              dueAt: due,
            });
            if (j.post?.id !== r.buffer_id)
              throw new Error("Buffer-ID unklar.");
            await recordPost(asset.id, r.channel, j.post);
            const checked = await gateway("status", { bufferId: r.buffer_id });
            await recordPost(asset.id, r.channel, checked.data?.post);
          } catch {
            await patchDelivery(asset.id, r.channel, {
              status: "manual_review",
              error:
                "Änderung nicht bestätigt. Status prüfen; keine neue Veröffentlichung anlegen.",
              updated_at: now(),
            });
          }
        }
        const next = await deliveries(asset.id);
        if (
          b.action === "withdraw" &&
          next.every((r) => r.status === "draft_buffer" && !r.error)
        ) {
          await mark(asset.id, "cancelled", next);
          await patchDraft(asset.id, {
            status: "draft",
            due_at: null,
            updated_at: now(),
          });
          return Response.json({
            status: "draft",
            draft: await draftResult(asset.id),
          });
        }
        const status = overallState(next);
        const confirmed =
          b.action === "reschedule" &&
          status === "scheduled" &&
          next.every((r) => r.due_at === due && !r.error);
        await patchDraft(asset.id, {
          status: confirmed ? "scheduled" : "manual_review",
          updated_at: now(),
        });
        await mark(
          asset.id,
          confirmed ? "scheduled" : "partial_failed",
          next,
          confirmed ? null : d.due_at,
        );
        return Response.json({
          status: confirmed ? "scheduled" : "manual_review",
          draft: await draftResult(asset.id),
        });
      } catch (e) {
        await patchDraft(asset.id, {
          status: moved || b.action === "withdraw" ? "manual_review" : d.status,
          updated_at: now(),
        });
        throw e;
      }
    }
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "Der Schritt ist fehlgeschlagen." },
      { status: 400 },
    );
  }
}
