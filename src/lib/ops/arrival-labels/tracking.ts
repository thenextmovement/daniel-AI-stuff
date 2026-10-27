// DHL Express uses ten-digit waybills. Never coerce these identifiers to numbers.
export function cardDhlNumbers(title: string, field?: string | null) {
  return [...new Set(`${title} ${field || ''}`.match(/(?<![\d+])\d{10}(?!\d)/g) || [])];
}

export function resolveCardDhlTracking(title: string, field?: string | null) {
  const titleNumbers = cardDhlNumbers(title);
  const raw = String(field || '').trim();
  const fieldNumbers = cardDhlNumbers('', raw);
  const invalid = (reason: string) => ({ trackingNumber: null, trackingNumbers: [] as string[], reason });
  // Preserve single-number fields. Multi-package fields must be a complete DHL-only list.
  if (raw && (/\b(fedex|dpd|ups|usps)\b/i.test(raw) || !fieldNumbers.length || fieldNumbers.length > 99
    || (fieldNumbers.length > 1 && !/^(?:DHL\s*)?\d{10}(?:[\s,;|/]+(?:DHL\s*)?\d{10})*$/i.test(raw)))) {
    return invalid('invalid_tracking_field');
  }
  if ((!raw && titleNumbers.length > 1) || (raw && titleNumbers.some(n => !fieldNumbers.includes(n)))) {
    return invalid('conflicting_tracking');
  }
  const trackingNumbers = raw ? fieldNumbers : titleNumbers;
  return { trackingNumber: trackingNumbers[0] || null, trackingNumbers, reason: null };
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
  // An exact, newer German delivery is evidence that earlier transit/customs holds
  // have ended. Same-time or newer warnings and unreviewed delivery details still block.
  const deliveredAt = Math.max(-Infinity, ...events.filter(event =>
    german(event) && /^(delivered|sendung zugestellt)[.]?$/.test(event.text.trim())
  ).map(event => event.time));
  const holdText = /\[unreviewed carrier details\]|\b(hold|held|exception|delay|clearance|customs|zoll|return|returned|zuruck|zurück|verzogerung|verzögerung)\b/;
  // Only this exact generic update can be superseded by later physical processing.
  // Unknown customs text, additional instructions and real holds remain blocking.
  const genericUpdate = 'customs clearance status updated. note - the customs clearance process may start while the shipment is in transit to the destination.';
  const movements = events.filter(event => german(event) && /^(processed at|shipment has departed from a dhl facility)\b/.test(event.text) && !holdText.test(event.text));
  const resolvedGenericUpdate = (event: typeof events[number]) =>
    german(event) && event.text.trim().replace(/\s+/g, ' ') === genericUpdate &&
    movements.some(movement => movement.time > event.time);
  // A routine transit scan with opaque supplementary text is resolved by a
  // strictly later clean German physical scan. Real hold/customs/action text is not.
  const routineTransit = /^(?:arrived at (?:a )?dhl (?:sort|delivery) facility|processed at|shipment has departed from a dhl facility)(?: [a-z .-]+)?$/;
  const resolvedTransitSupplement = (event: typeof events[number]) => {
    const plain = event.text.replace('[unreviewed carrier details]', '').trim();
    return hasSupplement(event) && german(event) && routineTransit.test(plain)
      && !/\b(hold|held|customs|clearance|zoll|exception|delay|contact|required|return|returned)\b/.test(plain)
      && events.some(next => next.time > event.time && german(next) && !holdText.test(next.text)
        && (routineTransit.test(next.text.trim()) || /^((?:shipment is )?out with courier for delivery|delivered|sendung zugestellt)[.]?$/.test(next.text.trim())));
  };
  if (events.some(event => event.time >= clearedAt && event.time >= deliveredAt && !complete(event) && holdText.test(event.text) && !resolvedGenericUpdate(event) && !resolvedTransitSupplement(event))) return denied('later_carrier_hold');
  return { allowed: true, reason: 'germany_arrived_customs_released' };
}
