import type { Draft, Offer } from "../../src/dhl-preview.js";
export const draft: Draft = {
  shipper:{name:"NEONTRIP TEST",addressLines:["Bilker Allee 29"],postalCode:"40219",city:"Düsseldorf",countryCode:"DE",phone:"+4921154257240"},
  receiver:{name:"TESTEMPFÄNGER – NICHT VERSENDEN",addressLines:["Teststraße 1"],postalCode:"10115",city:"Berlin",countryCode:"DE",phone:"+49301234567"},
  parcels:[{lengthCm:40,widthCm:30,heightCm:20,weightKg:2}],
  shippingDates:["2026-11-27T10:00:00+01:00"],customsDeclarable:false,dutiesPayer:"receiver",
};
export const offer: Offer = {id:"fixture-offer",shippingDate:draft.shippingDates[0]!,productCode:"N",productName:"TESTANGEBOT",amount:42.5,currency:"EUR",taxNote:"Steuerstatus nicht bestätigt",source:"dhl-account-rate",environment:"test"};
