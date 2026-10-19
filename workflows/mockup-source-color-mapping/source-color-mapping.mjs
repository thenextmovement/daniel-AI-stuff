const DEFAULT_FIELD_SLOTS = 4;

function normalizedEntries(valuesByIndex) {
  return Object.entries(valuesByIndex || {})
    .map(([index, value]) => ({
      index: Number(index),
      value: String(value || "").trim(),
    }))
    .filter((entry) => Number.isInteger(entry.index) && entry.index > 0 && entry.value)
    .sort((left, right) => left.index - right.index);
}

export function resolveDesignIndexedValue(
  valuesByIndex,
  linkedItemIndex,
  designCount,
  fieldSlots = DEFAULT_FIELD_SLOTS,
) {
  const entries = normalizedEntries(valuesByIndex);
  if (entries.length === 0) return "";

  const safeDesignCount = Math.max(1, Math.min(Number(designCount) || 1, fieldSlots));
  const safeDesignIndex = Math.max(
    0,
    Math.min(Number(linkedItemIndex) || 0, safeDesignCount - 1),
  );

  if (safeDesignCount === 1) {
    return entries[0].value;
  }

  // Trello has four consecutive Size/Color offer rows. With multiple source
  // designs, every design owns a consecutive slice:
  // 2 designs => rows 1-2 and 3-4; 4 designs => one row each.
  const rangeStart = Math.floor((safeDesignIndex * fieldSlots) / safeDesignCount) + 1;
  const rangeEnd = Math.floor(((safeDesignIndex + 1) * fieldSlots) / safeDesignCount);
  const grouped = entries.find(
    (entry) => entry.index >= rangeStart && entry.index <= rangeEnd,
  );
  if (grouped) return grouped.value;

  // Legacy cards may store one value per design without filling all rows.
  const direct = entries.find((entry) => entry.index === safeDesignIndex + 1);
  if (direct) return direct.value;

  return entries[0].value;
}

