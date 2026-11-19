import test from "node:test";
import assert from "node:assert/strict";
import {customerPhone} from "../../src/lib/ops/voice-customer-phones";
import {customerLink} from "../../src/lib/ops/voice-customer-links";
import {exactIncomingCustomer} from "../../src/lib/ops/voice-phone-incoming";
import type {VoiceDirectoryContact} from "../../src/lib/ops/voice-directory";
test("customer numbers normalize domestic and international formatting",()=>{
 for(const input of ["01543 12345678","+49 (0)1543 12345678","0049 (0)1543 12345678","0049154312345678","01543.12345678"])assert.equal(customerPhone(input),"+49154312345678");
 assert.equal(customerPhone("+43 664 1234567"),"+436641234567");
 for(const invalid of ["123","abc0154312345678","javascript:123","0154;DROP"]){assert.throws(()=>customerPhone(invalid));}
});
test("additional incoming numbers resolve only an unambiguous customer",()=>{
 const a={customerId:"a",phone:"+493055500001",phoneNumbers:["+493055500001","+49154312345678"]} as VoiceDirectoryContact;
 assert.equal(exactIncomingCustomer("+49154312345678",[a],null),a);
 assert.equal(exactIncomingCustomer("+49154312345678",[a,{...a,customerId:"b"}],null),null);
 assert.equal(exactIncomingCustomer("+49154312345678",[a],40),null);
});
test("customer links only accept intended HTTPS destinations",()=>{
 assert.equal(customerLink("https://trello.com/c/Abcd1234/name","quentin"),"https://trello.com/c/Abcd1234/name");
 assert.equal(customerLink("https://offers.neontrip.de/offer/123","offer"),"https://offers.neontrip.de/offer/123");
 for(const url of ["javascript:alert(1)","https://trello.com.evil.test/c/Abcd1234","https://user:pass@trello.com/c/Abcd1234","https://trello.com/b/Abcd1234","http://trello.com/c/Abcd1234"])assert.throws(()=>customerLink(url,"inquiry"));
 assert.throws(()=>customerLink("https://evil.test/offer","offer"));
});
