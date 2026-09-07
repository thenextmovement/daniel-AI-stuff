export type AuditRecord = {
  timestamp: string;
  correlationId: string;
  clientId: string;
  actor: string;
  role: string;
  capability: string;
  target?: Record<string, string>;
  outcome: "success" | "denied" | "failure";
  durationMs: number;
  errorCode?: string;
};

export type AuditSink = (record: AuditRecord) => void;

export const jsonAuditSink: AuditSink = (record) => {
  process.stdout.write(`${JSON.stringify({ event: "mcp_audit", ...record })}\n`);
};
