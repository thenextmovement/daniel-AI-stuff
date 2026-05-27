export type RequestIdSessionMaps<TPreferredTab, TBadgeLabel> = {
  preferredTabsByRequestId?: Record<string, TPreferredTab | null>;
  badgeLabelsByRequestId?: Record<string, TBadgeLabel | undefined>;
};

export function buildRequestIdSessionMaps<TRecord extends { requestId: string }, TPreferredTab, TBadgeLabel>(
  records: TRecord[],
  {
    preferredTabByRecord,
    badgeLabelByRecord,
  }: {
    preferredTabByRecord: (record: TRecord) => TPreferredTab | null;
    badgeLabelByRecord: (record: TRecord) => TBadgeLabel | undefined;
  },
): RequestIdSessionMaps<TPreferredTab, TBadgeLabel> {
  return {
    preferredTabsByRequestId: Object.fromEntries(records.map((record) => [record.requestId, preferredTabByRecord(record)])),
    badgeLabelsByRequestId: Object.fromEntries(records.map((record) => [record.requestId, badgeLabelByRecord(record)])),
  };
}
