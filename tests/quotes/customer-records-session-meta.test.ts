import test from "node:test";
import assert from "node:assert/strict";

import {
  getActionQueueSessionMeta,
  getCommercialDeskSessionMeta,
  getFocusSessionLabel,
  getGlobalRadarSessionMeta,
  getOperatorRadarSessionMeta,
  getOpsFeedSessionMeta,
  getPersonalLaneBadgeLabel,
  getPersonalLaneSessionMeta,
  getRecordSessionMeta,
  getSessionContextLabel,
  getSessionDetail,
  getSessionPreferredTab,
  getSessionPrimaryActionLabel,
  getSessionSourceLabel,
  getSystemGapSessionMeta,
  getWorkboardSectionSessionMeta,
} from "../../src/lib/ops/customer-records-session-meta";

test("getSessionSourceLabel falls back to source defaults", () => {
  assert.equal(getSessionSourceLabel("workboard"), "Arbeitsbereich");
  assert.equal(getSessionSourceLabel("inbox"), "Eingang");
  assert.equal(getSessionSourceLabel("workboard", "Problemfälle"), "Problemfälle");
});

test("getSessionDetail keeps commercial and recovery semantics separate", () => {
  assert.match(getSessionDetail("Abschluss"), /Verkaufs- und Angebotslage/);
  assert.match(getSessionDetail("Kaufinteresse"), /Rückgewinnung/);
  assert.match(getSessionDetail(undefined), /Fall für Fall/);
});

test("getPersonalLaneBadgeLabel maps personal lanes to stable session badges", () => {
  assert.equal(getPersonalLaneBadgeLabel("commercial"), "Abschluss");
  assert.equal(getPersonalLaneBadgeLabel("sales_recovery"), "Kaufinteresse");
  assert.equal(getPersonalLaneBadgeLabel("callbacks"), "Rückrufe");
  assert.equal(getPersonalLaneBadgeLabel("handover"), "Mein Arbeitsbereich");
});

test("getPersonalLaneSessionMeta returns stable badge and entry tab for personal workboard lanes", () => {
  assert.deepEqual(getPersonalLaneSessionMeta("special_cases"), {
    badgeLabel: "Problemfälle",
    preferredTab: "contact",
  });
  assert.deepEqual(getPersonalLaneSessionMeta("commercial"), {
    badgeLabel: "Abschluss",
    preferredTab: "deal",
  });
});

test("getWorkboardSectionSessionMeta returns consistent badge and preferred tab", () => {
  assert.deepEqual(getWorkboardSectionSessionMeta("recent_replies"), {
    badgeLabel: "Antworten",
    preferredTab: "communication",
  });
  assert.deepEqual(getWorkboardSectionSessionMeta("sales_recovery"), {
    badgeLabel: "Kaufinteresse",
    preferredTab: "deal",
  });
});

test("getOperatorRadarSessionMeta keeps personal focus tracks session-aware", () => {
  assert.deepEqual(getOperatorRadarSessionMeta("replies"), {
    badgeLabel: "Antworten",
    preferredTab: "communication",
  });
  assert.deepEqual(getOperatorRadarSessionMeta("signals"), {
    badgeLabel: "Kaufinteresse",
    preferredTab: "deal",
  });
  assert.deepEqual(getOperatorRadarSessionMeta("clusters"), {
    badgeLabel: "Kontaktdossier",
    preferredTab: "contact",
  });
});

test("getGlobalRadarSessionMeta aligns radar tiles with session and tab semantics", () => {
  assert.deepEqual(getGlobalRadarSessionMeta("recent_replies"), {
    badgeLabel: "Antworten",
    preferredTab: "communication",
  });
  assert.deepEqual(getGlobalRadarSessionMeta("order_open_ops"), {
    badgeLabel: "Abschluss",
    preferredTab: "history",
  });
  assert.deepEqual(getGlobalRadarSessionMeta("missing_design_context"), {
    badgeLabel: "Arbeitsbereich",
    preferredTab: "trello",
  });
});

test("getActionQueueSessionMeta aligns action blocks with session semantics", () => {
  assert.deepEqual(getActionQueueSessionMeta("reply"), {
    badgeLabel: "Antworten",
    preferredTab: "communication",
  });
  assert.deepEqual(getActionQueueSessionMeta("signal"), {
    badgeLabel: "Kaufinteresse",
    preferredTab: "deal",
  });
  assert.deepEqual(getActionQueueSessionMeta("context"), {
    badgeLabel: "Arbeitsbereich",
    preferredTab: null,
  });
});

test("getCommercialDeskSessionMeta keeps recovery separate from commercial desk work", () => {
  assert.deepEqual(getCommercialDeskSessionMeta("viewed_without_order"), {
    badgeLabel: "Kaufinteresse",
    preferredTab: "deal",
  });
  assert.deepEqual(getCommercialDeskSessionMeta("live_quotes"), {
    badgeLabel: "Abschluss",
    preferredTab: "deal",
  });
});

test("getSystemGapSessionMeta maps central ops gaps to the right sessions", () => {
  assert.deepEqual(getSystemGapSessionMeta("email_drift"), {
    badgeLabel: "Reparaturen",
    preferredTab: "contact",
  });
  assert.deepEqual(getSystemGapSessionMeta("viewed_without_order"), {
    badgeLabel: "Kaufinteresse",
    preferredTab: "sales",
  });
  assert.deepEqual(getSystemGapSessionMeta("callback_no_phone"), {
    badgeLabel: "Rückrufe",
    preferredTab: "contact",
  });
});

test("getOpsFeedSessionMeta derives feed sessions from operational context", () => {
  assert.deepEqual(
    getOpsFeedSessionMeta({
      direction: "inbound",
      hasSpecialCase: false,
      isHandover: false,
      hasRepairGap: false,
      hasActiveFlow: false,
      hasCluster: false,
      hasSalesRecovery: false,
      hasCommercial: false,
      hasCallbackPressure: false,
      hasFollowupPressure: false,
    }),
    {
      badgeLabel: "Antworten",
      preferredTab: "communication",
    },
  );
  assert.deepEqual(
    getOpsFeedSessionMeta({
      direction: "system",
      hasSpecialCase: false,
      isHandover: false,
      hasRepairGap: false,
      hasActiveFlow: false,
      hasCluster: false,
      hasSalesRecovery: true,
      hasCommercial: true,
      hasCallbackPressure: false,
      hasFollowupPressure: false,
    }),
    {
      badgeLabel: "Kaufinteresse",
      preferredTab: "deal",
    },
  );
  assert.deepEqual(
    getOpsFeedSessionMeta({
      direction: "internal",
      hasSpecialCase: false,
      isHandover: true,
      hasRepairGap: false,
      hasActiveFlow: false,
      hasCluster: false,
      hasSalesRecovery: false,
      hasCommercial: false,
      hasCallbackPressure: false,
      hasFollowupPressure: false,
    }),
    {
      badgeLabel: "Übergaben",
      preferredTab: "contact",
    },
  );
});

test("getRecordSessionMeta restores the right session for persisted case reopen flows", () => {
  assert.deepEqual(
    getRecordSessionMeta({
      hasSpecialCase: false,
      isHandover: false,
      repairGapKey: "email_drift",
      hasInboundReply: false,
      hasActiveFlow: false,
      hasCluster: false,
      hasSalesRecovery: false,
      hasCommercial: false,
      hasCallbackPressure: false,
      hasFollowupPressure: false,
    }),
    {
      badgeLabel: "Reparaturen",
      preferredTab: "contact",
    },
  );
  assert.deepEqual(
    getRecordSessionMeta({
      hasSpecialCase: false,
      isHandover: false,
      repairGapKey: null,
      hasInboundReply: true,
      hasActiveFlow: false,
      hasCluster: false,
      hasSalesRecovery: false,
      hasCommercial: false,
      hasCallbackPressure: false,
      hasFollowupPressure: false,
    }),
    {
      badgeLabel: "Antworten",
      preferredTab: "communication",
    },
  );
  assert.deepEqual(
    getRecordSessionMeta({
      hasSpecialCase: false,
      isHandover: false,
      repairGapKey: null,
      hasInboundReply: false,
      hasActiveFlow: false,
      hasCluster: true,
      hasSalesRecovery: false,
      hasCommercial: false,
      hasCallbackPressure: false,
      hasFollowupPressure: false,
    }),
    {
      badgeLabel: "Kontaktdossier",
      preferredTab: "contact",
    },
  );
});

test("getSession labels stay aligned for next-step CTA and supporting context", () => {
  assert.equal(getSessionPrimaryActionLabel("Abschluss"), "Nächsten Abschlussfall öffnen");
  assert.equal(getSessionContextLabel("Abschluss"), "Abschluss");
  assert.equal(getSessionPrimaryActionLabel("Kontaktdossier"), "Nächstes Kontaktdossier öffnen");
  assert.equal(getSessionContextLabel("Kontaktdossier"), "Kontaktdossier");
  assert.equal(getSessionPrimaryActionLabel(undefined), "Nächsten Fall öffnen");
  assert.equal(getSessionContextLabel(undefined), "Weiterarbeit");
});

test("getSessionPreferredTab keeps badge-based fallbacks aligned with session semantics", () => {
  assert.equal(getSessionPreferredTab("Abschluss"), "deal");
  assert.equal(getSessionPreferredTab("Kaufinteresse"), "deal");
  assert.equal(getSessionPreferredTab("Antworten"), "communication");
  assert.equal(getSessionPreferredTab("Kontaktdossier"), "contact");
  assert.equal(getSessionPreferredTab("Abläufe"), null);
  assert.equal(getSessionPreferredTab(undefined), null);
});

test("getFocusSessionLabel sharpens generic review headings without duplicating specific session labels", () => {
  assert.equal(getFocusSessionLabel("Merkliste", "Reparaturen"), "Merkliste • Reparaturen");
  assert.equal(getFocusSessionLabel("Zuletzt geöffnet", "Antworten"), "Zuletzt geöffnet • Antworten");
  assert.equal(getFocusSessionLabel("Suche • samuele", "Abschluss"), "Suche • samuele • Abschluss");
  assert.equal(getFocusSessionLabel("Kontaktdossier", "Kontaktdossier"), "Kontaktdossier");
  assert.equal(getFocusSessionLabel("Fallkontext", "Kontaktdossier"), "Kontaktdossier");
});
