import assert from 'node:assert/strict';
import test from 'node:test';
import * as filters from '../../src/lib/ops/dunning-filter';
import * as nomination from '../../src/lib/ops/dunning-court-nomination';
test('blocked-only selection overrides hide-blocked and distinguishes Shopify holds', () => {
 const match = (filters as any).matchesDunningBlockFilter;
 assert.equal(typeof match, 'function');
 for (const hide of [true,false]) {
  assert.equal(match({paused:true,stopTag:false}, 'blocked',hide),true);
  assert.equal(match({paused:false,stopTag:true}, 'shopify',hide),true);
  assert.equal(match({paused:true,stopTag:false}, 'shopify',hide),false);
  assert.equal(match({paused:false,stopTag:false}, 'blocked',hide),false);
 }
 assert.equal(match({paused:true,stopTag:false}, 'all',true),false);
 assert.equal(match({paused:true,stopTag:false}, 'all',false),true);
});
test('court warning uses actual age and the 21 day boundary, not overdue days', () => {
 const message = (nomination as any).courtNominationConfirmation;
 assert.equal(typeof message, 'function');
 const now = new Date('2026-10-21T12:00:00Z');
 assert.match(message('#NEONT1','2026-10-09T12:00:00Z',now),/erst 12 Tage/);
 assert.match(message('#NEONT1','2026-10-01T12:00:00Z',now),/erst 20 Tage/);
 assert.doesNotMatch(message('#NEONT1','2026-09-30T12:00:00Z',now),/erst .* Tage/);
 assert.match(message('#NEONT1',null,now),/Bestelldatum.*fehlt/);
 assert.match(message('#NEONT1','2026-10-22T12:00:00Z',now),/Bestelldatum.*Zukunft/);
 assert.match(message('#NEONT1','2026-10-01T12:00:00Z',now),/kein Antrag erstellt oder versandt/);
});
