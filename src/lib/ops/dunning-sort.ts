import type { DunningCaseState, DunningCaseSummary } from "./dunning";

export type DunningCaseSort =
  | "priority"
  | "amount_desc"
  | "amount_asc"
  | "stage_desc"
  | "stage_asc"
  | "next_action_asc"
  | "next_action_desc"
  | "overdue_desc"
  | "overdue_asc"
  | "order_oldest"
  | "order_newest"
  | "activity_desc"
  | "activity_asc"
  | "party_asc"
  | "party_desc";

const statePriority: Record<DunningCaseState, number> = {
  court_review: 0,
  reply_received: 1,
  action_required: 2,
  data_issue: 3,
  final_wait: 4,
  paused: 5,
  scheduled: 6,
  closed: 7,
};

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc",
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function partyLabel(entry: DunningCaseSummary) {
  return (
    [entry.company, entry.customerName].filter(Boolean).join(" ").trim() ||
    entry.email ||
    entry.orderNumber
  );
}

function comparePriority(left: DunningCaseSummary, right: DunningCaseSummary) {
  return (
    statePriority[left.state] - statePriority[right.state] ||
    (right.daysOverdue ?? -9999) - (left.daysOverdue ?? -9999) ||
    right.amountCents - left.amountCents ||
    left.orderNumber.localeCompare(right.orderNumber, "de-DE")
  );
}

export function sortDunningCases(
  cases: DunningCaseSummary[],
  sort: DunningCaseSort,
) {
  return [...cases].sort((left, right) => {
    let comparison = 0;
    if (sort === "amount_desc")
      comparison = right.amountCents - left.amountCents;
    else if (sort === "amount_asc")
      comparison = left.amountCents - right.amountCents;
    else if (sort === "stage_desc")
      comparison = right.currentStage - left.currentStage;
    else if (sort === "stage_asc")
      comparison = left.currentStage - right.currentStage;
    else if (sort === "next_action_asc")
      comparison = compareNullableNumber(
        timestamp(left.nextActionAt),
        timestamp(right.nextActionAt),
        "asc",
      );
    else if (sort === "next_action_desc")
      comparison = compareNullableNumber(
        timestamp(left.nextActionAt),
        timestamp(right.nextActionAt),
        "desc",
      );
    else if (sort === "overdue_desc")
      comparison = compareNullableNumber(
        left.daysOverdue,
        right.daysOverdue,
        "desc",
      );
    else if (sort === "overdue_asc")
      comparison = compareNullableNumber(
        left.daysOverdue,
        right.daysOverdue,
        "asc",
      );
    else if (sort === "order_oldest")
      comparison = compareNullableNumber(
        timestamp(left.orderCreatedAt),
        timestamp(right.orderCreatedAt),
        "asc",
      );
    else if (sort === "order_newest")
      comparison = compareNullableNumber(
        timestamp(left.orderCreatedAt),
        timestamp(right.orderCreatedAt),
        "desc",
      );
    else if (sort === "activity_desc")
      comparison = compareNullableNumber(
        timestamp(left.lastActivityAt),
        timestamp(right.lastActivityAt),
        "desc",
      );
    else if (sort === "activity_asc")
      comparison = compareNullableNumber(
        timestamp(left.lastActivityAt),
        timestamp(right.lastActivityAt),
        "asc",
      );
    else if (sort === "party_asc")
      comparison = partyLabel(left).localeCompare(partyLabel(right), "de-DE", {
        sensitivity: "base",
      });
    else if (sort === "party_desc")
      comparison = partyLabel(right).localeCompare(partyLabel(left), "de-DE", {
        sensitivity: "base",
      });
    else return comparePriority(left, right);

    return comparison || comparePriority(left, right);
  });
}
