"use client";
import {getCountries,getCountryCallingCode,type CountryCode} from "libphonenumber-js";
const countryNames=new Intl.DisplayNames(["de"],{type:"region"});
const flag=(country:string)=>String.fromCodePoint(...[...country].map(c=>127397+c.charCodeAt(0)));
const priority=["DE","AT","CH"];
const eu=new Set("BE BG CY CZ DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" "));
const countries=getCountries().sort((a,b)=>{
 const rank=(c:string)=>priority.includes(c)?priority.indexOf(c):eu.has(c)?3:4;
 return rank(a)-rank(b) || (countryNames.of(a)||a).localeCompare(countryNames.of(b)||b,"de");
});
export function PhoneCountrySelect({value,onChange,label}:{value:CountryCode;onChange:(country:CountryCode)=>void;label?:string}){return <select aria-label={label} value={value} onChange={e=>onChange(e.target.value as CountryCode)}>{countries.map(c=><option key={c} value={c}>{flag(c)} {countryNames.of(c)} (+{getCountryCallingCode(c)})</option>)}</select>;}
