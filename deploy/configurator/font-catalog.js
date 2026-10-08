/** Metadata-only discovery. This module never downloads fonts or sends text.
 * Fetch a selected entry.file.url separately after an explicit user selection.
 */
export const FONT_CATALOG_CATEGORIES=Object.freeze([
  {id:'all',label:'Alle Stile'},
  {id:'script',label:'Schreibschrift / Handschrift'},
  {id:'serif',label:'Mit Serifen'},
  {id:'sans',label:'Ohne Serifen'},
  {id:'display',label:'Dekorativ'}
].map(Object.freeze));
const CATEGORY_IDS=new Set(FONT_CATALOG_CATEGORIES.map(c=>c.id));
// Keep the pinned catalogue's legacy metadata intact. Discovery uses its source category.
const STORED_CATEGORY_IDS=new Set(['serif','script','print','double-line']);
const SOURCE_STYLES=Object.freeze({'Handwriting':'script','Serif':'serif','Sans Serif':'sans','Display':'display'});
export function catalogFontStyle(entry){return SOURCE_STYLES[entry.sourceCategory]||null;}
// Reviewed against the 37 local font files and rendered previews on 6 October 2026.
export const NEON_FONT_CATEGORIES=Object.freeze({
  script:Object.freeze(['Alexa','Amanda','Amsterdam','Austin','Barcelona','Bayview','Beachfront','Buttercup','Chelsea','Freehand','Freespirit','Greenworld','Hamillton','LoveNote','Neonscript','Nevada','NewCursive','Northshore','Rocket','Royalty','Signature','Vintage','WildScript']),
  serif:Object.freeze(['ClassicType','Typewriter']),
  sans:Object.freeze(['Avante','LoveNeon','Mayfair','Melbourne','Monaco','NeonGlow','NeonLite','Neontrace','Waikiki']),
  display:Object.freeze(['Marquee','NeoTokyo','SciFi'])
});
// Actual local worker previews show two light contours. This is a style, not a production guarantee.
export const NEON_DOUBLE_LINE_FONTS=Object.freeze(['LoveNeon','Marquee','Mayfair','NeonGlow','Nevada','SciFi']);
const LICENSE_IDS=new Set(['OFL-1.1','Apache-2.0','Ubuntu-font-1.0']);
const indices=new WeakMap();let loading;
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de-DE').trim();
function officialRawURL(value){
  if(typeof value!=='string')return false;
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='raw.githubusercontent.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/google\/fonts\/[a-f0-9]{40}\/(ofl|apache|ufl)\/[a-z0-9]+\//.test(u.pathname);}catch{return false;}
}
export function validateCatalogFont(entry){
  if(!entry||!/^gf-[a-z0-9]+$/.test(entry.id)||typeof entry.family!=='string'||!entry.family||entry.family.length>200)throw new Error('Ungültiger Schrifteintrag.');
  if(!STORED_CATEGORY_IDS.has(entry.category)||!Array.isArray(entry.categories)||!entry.categories.includes(entry.category)||entry.categories.some(c=>!STORED_CATEGORY_IDS.has(c)))throw new Error('Ungültige Schriftkategorie.');
  if(entry.file?.format!=='ttf'||!officialRawURL(entry.file.url)||!entry.file.url.endsWith('.ttf')||typeof entry.file.filename!=='string'||!entry.file.filename.endsWith('.ttf')||!Number.isSafeInteger(entry.file.bytes)||entry.file.bytes<=0||entry.file.bytes>100*1024*1024||!/^[a-f0-9]{40}$/.test(entry.file.gitBlobSha))throw new Error('Die Schriftdatei hat keine gültige Katalogquelle.');
  if(!LICENSE_IDS.has(entry.license?.spdx)||!officialRawURL(entry.license?.url))throw new Error('Der Lizenznachweis dieser Schrift fehlt.');
  const fileURL=new URL(entry.file.url),licenseURL=new URL(entry.license.url);
  if(fileURL.pathname.slice(0,fileURL.pathname.lastIndexOf('/'))!==licenseURL.pathname.slice(0,licenseURL.pathname.lastIndexOf('/')))throw new Error('Schriftdatei und Lizenz gehören nicht zur selben Familie.');
  if(entry.categories.includes('double-line')&&!officialRawURL(entry.categoryEvidenceURL))throw new Error('Der Beleg für die Outline-Kategorie fehlt.');
  return entry;
}
function indexCatalog(catalog){
  if(indices.has(catalog))return indices.get(catalog);
  if(!catalog||catalog.version!==1||!/^[a-f0-9]{40}$/.test(catalog.source?.commit)||!Array.isArray(catalog.families)||catalog.families.length>10000)throw new Error('Der Schriftkatalog ist ungültig.');
  const byId=new Map(),search=[];
  for(const entry of catalog.families){validateCatalogFont(entry);if(byId.has(entry.id)||!entry.file.url.includes('/'+catalog.source.commit+'/'))throw new Error('Der Schriftkatalog enthält widersprüchliche Einträge.');byId.set(entry.id,entry);search.push({entry,name:normalize(entry.family)});}
  const index={byId,search};indices.set(catalog,index);return index;
}
export async function loadFontCatalog({signal}={}){
  if(!loading)loading=(async()=>{
    const response=await fetch(new URL('./assets/font-catalog.json',import.meta.url),{signal,credentials:'omit'});
    if(!response.ok)throw new Error('Der Schriftkatalog konnte nicht geladen werden. Bitte erneut versuchen.');
    const text=await response.text();if(text.length>5*1024*1024)throw new Error('Der Schriftkatalog ist zu groß.');
    const catalog=JSON.parse(text);indexCatalog(catalog);
    for(const entry of catalog.families){Object.freeze(entry.file);Object.freeze(entry.license);Object.freeze(entry.categories);Object.freeze(entry.subsets);Object.freeze(entry);}
    Object.freeze(catalog.families);Object.freeze(catalog.source);return Object.freeze(catalog);
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
export function getCatalogFont(catalog,id){return indexCatalog(catalog).byId.get(id)||null;}
export function searchFontCatalog(catalog,{query='',category='all',trait='all',offset=0,limit=24}={}){
  if(!CATEGORY_IDS.has(category))throw new Error('Diese Schriftkategorie ist unbekannt.');
  if(!['all','outline'].includes(trait))throw new Error('Dieses Schriftmerkmal ist unbekannt.');
  const q=normalize(query).slice(0,160),terms=q.split(/\s+/).filter(Boolean);
  const results=indexCatalog(catalog).search.filter(({entry,name})=>(category==='all'||catalogFontStyle(entry)===category)&&(trait==='all'||entry.categories.includes('double-line'))&&terms.every(term=>name.includes(term)));
  if(q)results.sort((a,b)=>Number(b.name.startsWith(q))-Number(a.name.startsWith(q))||a.entry.family.localeCompare(b.entry.family,'de'));
  const start=Number.isSafeInteger(offset)?Math.max(0,offset):0,count=Number.isSafeInteger(limit)?Math.min(60,Math.max(1,limit)):24;
  return {items:results.slice(start,start+count).map(r=>r.entry),total:results.length,offset:start,limit:count,hasMore:start+count<results.length};
}
export function catalogFontAssetId(entry){validateCatalogFont(entry);return `upload-google-${entry.id}-${entry.file.gitBlobSha.slice(0,12)}`;}
