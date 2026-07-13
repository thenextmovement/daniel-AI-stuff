export type VoiceTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RuntimeSession = {
  attemptId: string;
  requestId: string;
  allowlistOnly: boolean;
  phoneE164: string;
  safetyIdentifier: string;
  modelId: string;
  voice: string;
  sessionConfig: Record<string, unknown>;
  instructions: string;
  tools: VoiceTool[];
};

type RecoveredCallState = {
  attemptId: string;
  openAiCallId: string | null;
  providerCallId: string | null;
  disclosureConfirmed: boolean;
  providerCompleted: boolean;
};

export type RecoveredRuntimeSession =
  | (RuntimeSession & RecoveredCallState & { recoveryAction: "reconnect" })
  | (RecoveredCallState & { recoveryAction: "terminate"; blockedReason: string })
  | (RecoveredCallState & { recoveryAction: "reconcile_provider"; blockedReason: string });

export type StructuredOutcome = {
  terminalStatus: "completed" | "failed" | "cancelled" | "handed_off";
  outcomeCode: string;
  summaryForHuman: string;
  customerIntent: string | null;
  productInterest: string | null;
  objections: string[];
  callbackAt: string | null;
  humanHandoffRequested: boolean;
  humanHandoffCompleted: boolean;
  customerRequestedStop: boolean;
  unsafeOrUnsupportedRequest: boolean;
  failureCode: string | null;
  failureDetail: string | null;
};
