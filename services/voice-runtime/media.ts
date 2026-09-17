import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { RuntimeConfig } from "./config.js";
import type { OpsClient } from "./ops-client.js";
import type { OpenAiLiveAdapter, LiveMediaTransport } from "./live.js";
import { TwilioMediaProtocol, validateMediaUpgrade, assertMediaAttempt, type MediaStart } from "./media-protocol.js";
import { verifyAttemptBinding } from "./security.js";
import { technicalOutcome } from "./outcomes.js";

export function installTwilioMedia(server: Server, config: RuntimeConfig, ops: OpsClient, live: OpenAiLiveAdapter) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128000, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    if (["/media/phone", "/media/phone/"].includes((request.url || "").split("?")[0])) return;
    const signature = request.headers["x-twilio-signature"];
    if (!validateMediaUpgrade({
      method: request.method, path: request.url, signature: typeof signature === "string" ? signature : undefined,
      publicUrl: config.publicUrl, authToken: config.twilioAuthToken,
    })) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, ws => connect(ws));
  });

  function connect(ws: WebSocket) {
    let start: MediaStart | null = null;
    let claimed = false, owned = false, stopped = false, failed = false, intentional = false, failureQueued = false;
    let closeHandler: ((clean: boolean) => void) | null = null;
    let playbackWaiter: ((complete: boolean) => void) | null = null;
    const startup = setTimeout(() => fail(), 5000);
    const protocol = new TwilioMediaProtocol(event => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 128000) throw new Error("twilio_output_unavailable");
      ws.send(JSON.stringify(event));
    });
    const transport: LiveMediaTransport = {
      activateInput: consume => {
        if (failed || stopped || ws.readyState !== WebSocket.OPEN) throw new Error("media_disconnected_during_start");
        protocol.activateInput(consume);
      },
      output: audio => protocol.output(audio),
      watchClose: handler => {
        closeHandler = handler;
        if (failed || stopped || ws.readyState !== WebSocket.OPEN) handler(stopped && !failed);
      },
      finishPlayback: async () => {
        if (protocol.playbackComplete) return true;
        if (stopped || failed || ws.readyState !== WebSocket.OPEN) return false;
        return new Promise<boolean>(resolve => {
          const timer = setTimeout(() => {
            playbackWaiter = null;
            resolve(false);
          }, 8000);
          playbackWaiter = complete => {
            clearTimeout(timer);
            playbackWaiter = null;
            resolve(complete);
          };
        });
      },
      close: () => {
        intentional = true;
        ws.close(1000, "session ended");
      },
    };
    function fail() {
      if (failed && (!claimed || owned || failureQueued)) return;
      failed = true;
      clearTimeout(startup);
      playbackWaiter?.(false);
      ws.close(1008, "media unavailable");
      if (owned) closeHandler?.(false);
      else if (claimed && start && !failureQueued) {
        failureQueued = true;
        const attemptId = start.attemptId;
        void ops.transcript(attemptId, [], "interrupted").catch(() => {}).then(() =>
          ops.finalize(attemptId, technicalOutcome("media_start_failed", "Die Audioverbindung konnte nicht sicher hergestellt werden.")),
        ).catch(() => console.error("voice media startup finalization pending", attemptId));
      }
    }
    async function bind(s: MediaStart) {
      if (s.accountSid !== config.twilioAccountSid || !config.sipBindingSecret ||
        !verifyAttemptBinding(s.attemptId, s.binding, config.sipBindingSecret))
        throw new Error("invalid_media_attempt_signature");
      const session = await ops.getAttempt(s.attemptId);
      assertMediaAttempt(s, session, config.twilioAccountSid, config.sipBindingSecret);
      if (failed || stopped || ws.readyState !== WebSocket.OPEN) return;
      const registration = await ops.event(s.attemptId, "telephony", "media.connected", "media-attempt:" + s.attemptId, { call_id: s.callSid, status: "connected" });
      if (!registration.result || registration.result.duplicate) throw new Error("media_attempt_already_consumed");
      claimed = true;
      const disclosure = await ops.event(s.attemptId, "runtime", "disclosure.confirmed", "media-disclosure:" + s.attemptId, { status: "confirmed" });
      if (!disclosure.result) throw new Error("media_disclosure_not_acknowledged");
      if (failed || stopped || ws.readyState !== WebSocket.OPEN) throw new Error("media_stopped_during_binding");
      await live.connectMedia(session, transport);
      owned = true;
    }
    ws.on("message", (data, binary) => {
      try {
        if (binary) throw new Error("binary_media_event");
        const event = protocol.read(String(data));
        if (event.type === "start") {
          start = event.start;
          clearTimeout(startup);
          void bind(start).catch(() => fail());
        } else if (event.type === "stop") {
          stopped = true;
          playbackWaiter?.(protocol.playbackComplete);
          closeHandler?.(true);
          if (!owned) ws.close(1000, "call ended");
        } else if (event.type === "mark" && protocol.playbackComplete) playbackWaiter?.(true);
      } catch { fail(); }
    });
    ws.on("error", () => fail());
    ws.on("close", () => {
      clearTimeout(startup);
      playbackWaiter?.(protocol.playbackComplete);
      closeHandler?.(!failed && (stopped || intentional));
      if (!owned && claimed) fail();
    });
  }
  return () => {
    for (const client of sockets.clients) client.close(1012, "runtime restarting");
    sockets.close();
  };
}
