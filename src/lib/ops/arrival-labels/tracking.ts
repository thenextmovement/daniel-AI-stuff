// DHL Express uses ten-digit waybills. Never coerce these identifiers to numbers.
export function resolveCardDhlTracking(title: string, field?: string | null) {
  const numbers = (value: string) => [...new Set(value.match(/(?<![\d+])\d{10}(?!\d)/g) || [])];
  const titleNumbers = numbers(title);
  const raw = String(field || '').trim();
  const fieldNumbers = numbers(raw);
  if (raw && (/\b(fedex|dpd|ups|usps)\b/i.test(raw) || fieldNumbers.length !== 1)) {
    return { trackingNumber: null, reason: 'invalid_tracking_field' };
  }
  if (titleNumbers.length > 1 || (fieldNumbers.length && titleNumbers.length && fieldNumbers[0] !== titleNumbers[0])) {
    return { trackingNumber: null, reason: 'conflicting_tracking' };
  }
  return { trackingNumber: fieldNumbers[0] || titleNumbers[0] || null, reason: null };
}

export type DhlReleaseEvent = { event_time: string; event_location: string | null; carrier_status_text: string | null };
export type DhlReleaseEvidence = { events: DhlReleaseEvent[]; lastCheckedAt: string | null; statusReason: string | null };

// Deliberately uses individual carrier text, not a shipment-wide normalized status.
export function assessDhlRelease(evidence: DhlReleaseEvidence, now = Date.now()) {
  const denied = (reason: string) => ({ allowed: false, reason });
  const checked = Date.parse(evidence.lastCheckedAt || '');
  if (!Number.isFinite(checked) || checked > now || now - checked > 24 * 60 * 60 * 1000) return denied('tracking_stale');
  if (/error|fail|reject/i.test(evidence.statusReason || '')) return denied('tracking_error');
  if (!evidence.events.length) return denied('tracking_events_missing');
  const events = evidence.events.map(event => ({ ...event, time: Date.parse(event.event_time), text: String(event.carrier_status_text || '').toLowerCase() }));
  if (events.some(event => !Number.isFinite(event.time) || event.time > now || !event.text.trim())) return denied('tracking_event_invalid');
  const german = (event: typeof events[number]) => /\b(germany|deutschland|de)\b/i.test(event.event_location || '');
  const hasSupplement = (event: typeof events[number]) => event.text.includes('[unreviewed carrier details]');
  const complete = (event: typeof events[number]) => !hasSupplement(event) && german(event) && /\b(clearance processing complete|customs clearance completed|released by customs|zollabfertigung abgeschlossen|zollfreigabe erteilt)\b/.test(event.text);
  const physical = (event: typeof events[number]) => german(event) && /\b(arrived at (?:a )?dhl|processed at|shipment has departed from a dhl|out with courier for delivery|delivered|sendung zugestellt|in der zustellung)\b/.test(event.text);
  const arrivals = events.filter(physical);
  const clearances = events.filter(complete);
  if (!arrivals.length) return denied('physical_germany_arrival_missing');
  if (!clearances.length) return denied('german_customs_release_missing');
  const clearedAt = Math.max(...clearances.map(event => event.time));
  const holdText = /\[unreviewed carrier details\]|\b(hold|held|exception|delay|clearance|customs|zoll|return|returned|zuruck|zurück|verzogerung|verzögerung)\b/;
  // Only this exact generic update can be superseded by later physical processing.
  // Unknown customs text, additional instructions and real holds remain blocking.
  const genericUpdate = 'customs clearance status updated. note - the customs clearance process may start while the shipment is in transit to the destination.';
  const movements = events.filter(event => german(event) && /^(processed at|shipment has departed from a dhl facility)\b/.test(event.text) && !holdText.test(event.text));
  const resolvedGenericUpdate = (event: typeof events[number]) =>
    german(event) && event.text.trim().replace(/\s+/g, ' ') === genericUpdate &&
    movements.some(movement => movement.time > event.time);
  if (events.some(event => event.time >= clearedAt && !complete(event) && holdText.test(event.text) && !resolvedGenericUpdate(event))) return denied('later_carrier_hold');
  return { allowed: true, reason: 'germany_arrived_customs_released' };
}
