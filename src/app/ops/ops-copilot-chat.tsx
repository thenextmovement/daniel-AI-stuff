"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ExternalLink, Loader2, RotateCcw, Send, X } from "lucide-react";

type CopilotSource = {
  label: string;
  href: string | null;
};

type CopilotAction = {
  label: string;
  href: string;
  kind: "open_link";
};

type CopilotAnswer = {
  answer: string;
  confidence: "high" | "medium" | "low";
  sources: CopilotSource[];
  actions: CopilotAction[];
  safety: {
    requiresHumanReview: boolean;
    reason: string | null;
  };
};

type CopilotApiResponse = {
  ok?: boolean;
  threadId?: string;
  message?: CopilotAnswer;
  usedTools?: string[];
  logged?: boolean;
  error?: string;
  issues?: string[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: CopilotSource[];
  actions?: CopilotAction[];
  safety?: CopilotAnswer["safety"];
};

const OPERATOR_STORAGE_KEY = "neontrip-ops-operator";
const IDEA_BOX_EVENT = "neontrip:ops-idea-box";
const MAX_HISTORY_MESSAGES = 10;

const suggestions = [
  "Wo finde ich die letzte E-Mail zu diesem Kunden?",
  "Welche Groessen stehen im Angebot?",
  "Pruef den Trackingstatus zu dieser Nummer.",
];

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatApiError(payload: CopilotApiResponse | null) {
  if (!payload) return "Copilot konnte nicht antworten.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Copilot konnte nicht antworten.";
}

function readOperatorName() {
  try {
    return window.localStorage.getItem(OPERATOR_STORAGE_KEY) || window.localStorage.getItem("neontrip-ops-idea-operator") || "";
  } catch {
    return "";
  }
}

function messagePayload(messages: ChatMessage[]) {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function OpsCopilotChat() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideaBoxOpen, setIdeaBoxOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOperatorName(readOperatorName());
  }, []);

  useEffect(() => {
    function onIdeaBoxChange(event: Event) {
      setIdeaBoxOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    }

    window.addEventListener(IDEA_BOX_EVENT, onIdeaBoxChange);
    return () => window.removeEventListener(IDEA_BOX_EVENT, onIdeaBoxChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }, 40);
  }, [messages, open]);

  const canSend = useMemo(() => draft.trim().length >= 2 && !loading, [draft, loading]);

  async function sendPrompt(prompt: string) {
    const content = prompt.trim();
    if (content.length < 2 || loading) return;

    const userMessage: ChatMessage = {
      id: makeId("copilot-user"),
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/ops/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          operatorName: operatorName || readOperatorName() || null,
          context: {
            path: window.location.pathname + window.location.search,
            pageTitle: document.title,
          },
          messages: messagePayload(nextMessages),
        }),
      });
      const payload = (await response.json().catch(() => null)) as CopilotApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.message) throw new Error(formatApiError(payload));

      if (payload.threadId) setThreadId(payload.threadId);
      setMessages((current) => [
        ...current,
        {
          id: makeId("copilot-assistant"),
          role: "assistant",
          content: payload.message?.answer || "",
          sources: payload.message?.sources || [],
          actions: payload.message?.actions || [],
          safety: payload.message?.safety,
        },
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Copilot konnte nicht antworten.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    void sendPrompt(draft);
  }

  function resetThread() {
    setThreadId(null);
    setMessages([]);
    setError(null);
    setDraft("");
  }

  if (ideaBoxOpen) return null;

  return (
    <div className="fixed bottom-2 right-2 z-[90] max-w-[calc(100vw-1rem)] text-stone-950 sm:bottom-20 sm:right-5 sm:max-w-[calc(100vw-2.5rem)]">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setOperatorName(readOperatorName());
          }}
          className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-full border border-stone-200 bg-white text-sm font-semibold shadow-2xl shadow-stone-950/15 transition hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950/20 sm:h-auto sm:w-auto sm:rounded-2xl sm:px-4 sm:py-3"
          aria-label="Copilot öffnen"
        >
          <Bot className="h-4 w-4 text-[#c21876]" />
          <span className="hidden sm:inline">Copilot</span>
        </button>
      ) : (
        <aside className="flex max-h-[min(720px,calc(100vh-7rem))] w-[460px] max-w-full flex-col overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-2xl shadow-stone-950/20">
          <div className="bg-stone-950 px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">NEONTRIP</p>
                <h2 className="mt-2 text-lg font-semibold">Ops Copilot</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetThread}
                  className="rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white"
                  aria-label="Neuen Copilot-Chat starten"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white"
                  aria-label="Copilot schließen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div ref={listRef} className="min-h-[240px] flex-1 overflow-y-auto bg-stone-50 px-4 py-4">
            {!messages.length ? (
              <div className="grid gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendPrompt(suggestion)}
                    className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:text-stone-950"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.role === "user"
                        ? "ml-8 bg-stone-950 text-white"
                        : "mr-8 border border-stone-200 bg-white text-stone-800"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {message.safety?.requiresHumanReview ? (
                      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                        {message.safety.reason || "Bitte kurz menschlich pruefen."}
                      </p>
                    ) : null}
                    {message.sources?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.sources.map((source, index) =>
                          source.href ? (
                            <a
                              key={`${source.label}-${index}`}
                              href={source.href}
                              className="inline-flex items-center gap-1 rounded-full border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600 transition hover:border-stone-300 hover:text-stone-950"
                            >
                              {source.label}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span
                              key={`${source.label}-${index}`}
                              className="rounded-full border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600"
                            >
                              {source.label}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                    {message.actions?.length ? (
                      <div className="mt-3 grid gap-2">
                        {message.actions.map((action, index) => (
                          <a
                            key={`${action.href}-${index}`}
                            href={action.href}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-stone-800"
                          >
                            {action.label}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {loading ? (
                  <div className="mr-8 inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Denke nach...
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {error ? <div className="border-t border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <form className="flex gap-2 border-t border-stone-200 bg-white p-3" onSubmit={submit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300 px-4 text-sm outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10"
              placeholder="Frage eingeben..."
            />
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-950 text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              aria-label="Copilot-Frage senden"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </aside>
      )}
    </div>
  );
}
