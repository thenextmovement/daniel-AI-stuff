import test from "node:test";
import assert from "node:assert/strict";
import {customerPhone} from "../../src/lib/ops/voice-customer-phones";
import {customerLink} from "../../src/lib/ops/voice-customer-links";
import {exactIncomingCustomer} from "../../src/lib/ops/voice-phone-incoming";
import type {VoiceDirectoryContact} from "../../src/lib/ops/voice-directory";
test("customer numbers normalize domestic and international formatting",()=>{
 for(const input of ["0151 23456789","+49 (0)151 23456789","0049 (0)151 23456789","004915123456789","0151.23456789"])assert.equal(customerPhone(input),"+4915123456789");
 assert.equal(customerPhone("+43 664 1234567"),"+436641234567");
 for(const invalid of ["123","abc0154312345678","javascript:123","0154;DROP"]){assert.throws(()=>customerPhone(invalid));}
});
test("additional incoming numbers resolve only an unambiguous customer",()=>{
 const a={customerId:"a",phone:"+493055500001",phoneNumbers:["+493055500001","+4915123456789"]} as VoiceDirectoryContact;
 assert.equal(exactIncomingCustomer("+4915123456789",[a],null),a);
 assert.equal(exactIncomingCustomer("+4915123456789",[a,{...a,customerId:"b"}],null),null);
 assert.equal(exactIncomingCustomer("+4915123456789",[a],40),null);
});
test("customer links only accept intended HTTPS destinations",()=>{
 assert.equal(customerLink("https://trello.com/c/Abcd1234/name","quentin"),"https://trello.com/c/Abcd1234/name");
 assert.equal(customerLink("https://offers.neontrip.de/offer/123","offer"),"https://offers.neontrip.de/offer/123");
 for(const url of ["javascript:alert(1)","https://trello.com.evil.test/c/Abcd1234","https://user:pass@trello.com/c/Abcd1234","https://trello.com/b/Abcd1234","http://trello.com/c/Abcd1234"])assert.throws(()=>customerLink(url,"inquiry"));
 assert.throws(()=>customerLink("https://evil.test/offer","offer"));
});

test("international customer numbers respect country plans and explicit prefixes",()=>{
 for(const [number,country,expected] of [
  ["0664 1234567","AT","+436641234567"],["079 123 45 67","CH","+41791234567"],
  ["06 6982","IT","+39066982"],["202-555-0123","US","+12025550123"],
  ["+44 20 7946 0018","DE","+442079460018"],["0044 20 7946 0018","AT","+442079460018"],
 ]) assert.equal(customerPhone(number,country),expected);
 for(const [number,country] of [["01543 12345678","DE"],["12345","CH"],["015123456789","ZZ"],["+49 151 23456789 ext 12","DE"]])
  assert.throws(()=>customerPhone(number,country));
});
