import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirstParcelDispatch, prepareFirstParcelSelection } from '../../src/lib/ops/arrival-labels/first-parcel';
const numbers = ['0012345678','1123456789','2234567890'];
const card = {id:'111111111111111111111111',name:'#NEONT123',url:'https://trello.example.invalid/one',trackingField:numbers.join(', ')};
async function fixture(selection: unknown[], run: () => Promise<void>) {
  const old = globalThis.fetch, url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://database.example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
  globalThis.fetch = async input => {
    assert.match(String(input), /arrival_label_first_parcels|arrival_labels_pin_first_parcel/);
    return Response.json(selection);
  };
  try { await run(); } finally {globalThis.fetch=old;
    if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;
    if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;
  }
}
test('pinned selection allows its own first package and survives replay', async () => {
  await fixture([{trello_card_id:card.id,tracking_numbers:numbers,blocked_reason:null}], async () => {
    assert.equal(await prepareFirstParcelSelection(card,numbers[0]),null);
    await assertFirstParcelDispatch(card,numbers[0]);
    await assert.rejects(assertFirstParcelDispatch(card,numbers[1]), /Dispatch/);
  });
});
test('reordering, removing or replacing numbers cannot acquire a new automatic package', async () => {
  await fixture([{trello_card_id:card.id,tracking_numbers:numbers,blocked_reason:null}], async () => {
    for(const field of [numbers.slice().reverse().join(', '),numbers[0],'3345678901']) {
      const changed={...card,trackingField:field};
      assert.match((await prepareFirstParcelSelection(changed,field.slice(0,10)))!, /geaendert/);
      await assert.rejects(assertFirstParcelDispatch(changed,field.slice(0,10)), /geaendert/);
    }
  });
});
test('historical purchase evidence and missing persistence both prevent dispatch', async () => {
  await fixture([{trello_card_id:card.id,tracking_numbers:numbers,blocked_reason:'Bereits gekauft; manuell pruefen.'}], async () => {
    assert.match((await prepareFirstParcelSelection(card,numbers[0]))!, /manuell/);
    await assert.rejects(assertFirstParcelDispatch(card,numbers[0]), /manuell/);
  });
  await fixture([], async () => {
    await assert.rejects(assertFirstParcelDispatch(card,numbers[0]), /Auswahl|Paketauswahl/);
    await assert.rejects(prepareFirstParcelSelection(card,numbers[0]), /gespeichert/);
  });
});
