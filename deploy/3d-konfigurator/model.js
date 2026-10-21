import {RAL_COLORS,ralCode} from './ral.js?v=21';
export {RAL_COLORS,ralCode};
export const DEFAULT = Object.freeze({version:3,text:'ATLAS',font:'modern',lighting:'back',mount:'individual',width:120,depth:5,color:'#fff1d6',acrylic:'#ffffff',backFinish:'brushed-gold',sideColor:'#252525',sideRal:'',bodyRal:'',railRal:'',plateRal:'',body:'#252525',plate:'#d8d0c4',railCustomColor:false,railColor:'#252525',wall:'warm',lightOn:true,night:false,spacing:5});
export const FONTS={
 modern:{label:'Modern',style:'Klar & kräftig'},
 montserrat:{label:'Montserrat',style:'Markant & vielseitig'},
 poppins:{label:'Poppins',style:'Rund & geometrisch'},
 oswald:{label:'Oswald',style:'Schmal & kraftvoll'},
 bebasneue:{label:'Bebas Neue',style:'Prägnante Großbuchstaben'},
 classic:{label:'Klassisch',style:'Zeitlose Serifen'},
 'serif-soft':{label:'Serif Soft',style:'Weiche Serifen'},
 cormorantgaramond:{label:'Cormorant Garamond',style:'Fein & elegant'},
 elegant:{label:'Elegant',style:'Klassischer Charakter'}
};
export const LABELS={font:Object.fromEntries(Object.entries(FONTS).map(([id,font])=>[id,font.label])),lighting:{front:'Frontbeleuchtet',back:'Rückbeleuchtet'},mount:{individual:'Einzelbuchstaben',rail:'Auf Schiene',plate:'Auf Platte'},wall:{warm:'Putz',concrete:'Beton',dark:'Anthrazit'}};
// Palette follows the current Neon editor; existing 3D draft values remain valid.
export const COLORS=[['#fff1d6','Warmweiß'],['#f5f7ff','Weiß'],['#fff97c','Zitronengelb'],['#f5c35b','Goldgelb'],['#ff8d02','Orange'],['#ff7575','Hellrot'],['#ff2a4d','Rot'],['#ff90ff','Neon-Pink'],['#eaa4ff','Weiches Rosa'],['#fc6fa8','Rosa'],['#8c59ff','Lila'],['#0274fc','Dunkelblau'],['#80baff','Hellblau'],['#90dcff','Eisblau'],['#80ffd9','Mintgrün'],['#8bdfb1','Grün'],['#0bd748','Dunkelgrün']];
export const ACRYLICS=COLORS.map(([color,name])=>[({'Weiß':'#ffffff','Rot':'#e62d38','Orange':'#ff8b24','Rosa':'#ee67af','Hellblau':'#2474e5','Grün':'#26a86b'})[name]||color,name==='Hellblau'?'Blau':name]);
export const FINISHES={
 'brushed-gold':{label:'Edelstahl gold lackiert',description:'Edelstahl, gebürstet und gold lackiert',color:'#c6a156',metalness:.95,roughness:.32,brushed:true},
 'brushed-steel':{label:'Edelstahl gebürstet',description:'Edelstahl, gebürstet in Natur',color:'#c5c9cc',metalness:.96,roughness:.32,brushed:true},
 'mirror-steel':{label:'Edelstahl verspiegelt',description:'Edelstahl, poliert und verspiegelt',color:'#f0f2f4',metalness:1,roughness:.045,brushed:false},
 'painted-steel':{label:'Edelstahl lackiert',description:'Edelstahl, farbig lackiert',color:null,metalness:.15,roughness:.36,brushed:false}
};
export const PAINT_PRESETS=[['#252525','Schwarz'],['#ffffff','Weiß'],['#c6a156','Gold']];
export const PAINT_FIELDS={sideColor:'sideRal',body:'bodyRal',railColor:'railRal',plate:'plateRal'};
export function paintMaterialSpec(s,key){
 const code=ralCode(s[PAINT_FIELDS[key]]),color=s[key];
 // Preview treatment for explicitly chosen gold/silver tones, never inferred
 // from the light colour or an arbitrary yellow/grey RGB neighbourhood.
 const gold=code?['1004','1036'].includes(code):color==='#c6a156';
 const silver=code?['7001','9006','9007','9022','9023'].includes(code):['#c5c9cc','#a8adb1'].includes(color);
 const finish=FINISHES[gold?'brushed-gold':silver?'brushed-steel':'painted-steel'];
 return {color,metalness:finish.metalness,roughness:finish.roughness,brushed:finish.brushed};
}
export function paintDescription(s,key){
 const code=ralCode(s[PAINT_FIELDS[key]]);
 return code?`RAL ${code} · ${RAL_COLORS[code].name}`:s[key].toUpperCase();
}
export function choosePaint(s,key,{color,ral}={}){
 if(!Object.hasOwn(PAINT_FIELDS,key))return s;
 const code=ralCode(ral),field=PAINT_FIELDS[key];
 if(ral!==undefined&&!code)return s;
 if(!code&&!/^#[\da-f]{6}$/i.test(color||''))return s;
 return {...s,[key]:code?RAL_COLORS[code].hex:color.toLowerCase(),[field]:code?`RAL ${code}`:'',...(key==='body'?{backFinish:'painted-steel'}:{})};
}
export function activeFinish(s){return s.lighting==='front'?'painted-steel':s.backFinish;}
export function finishDescription(s){if(s.lighting==='front')return `Seiten lackiert (${paintDescription(s,'sideColor')})`;const id=activeFinish(s);return FINISHES[id].description+(id==='painted-steel'?` (${paintDescription(s,'body')})`:'');}
export function lightColor(s){return s.lighting==='front'?s.acrylic:s.color;}
export function classicLook(s){
 return {...s,...(s.lighting==='front'?{sideColor:DEFAULT.sideColor,sideRal:'',acrylic:DEFAULT.acrylic}:{backFinish:DEFAULT.backFinish,color:DEFAULT.color})};
}
export function materialSpec(s){
 const f=FINISHES[activeFinish(s)],shell=s.lighting==='front'?paintMaterialSpec(s,'sideColor'):activeFinish(s)==='painted-steel'?paintMaterialSpec(s,'body'):{color:f.color,metalness:f.metalness,roughness:f.roughness,brushed:f.brushed};
 return {shell,rear:s.lighting==='back'?{color:'#ffffff',metalness:0,roughness:.4,brushed:false,emissive:s.lightOn?s.color:'#000000',emissiveIntensity:s.night?3:1.3}:{...shell},face:s.lighting==='front'?{color:s.acrylic,metalness:0,roughness:.27,brushed:false,emissive:s.lightOn?s.acrylic:'#000000',emissiveIntensity:s.night?2:1}:{...shell,emissive:'#000000',emissiveIntensity:0}};
}
export function normalize(raw={}){
 if(!raw||typeof raw!=='object')raw={};
 const s={...DEFAULT};
 for(const key of ['font','lighting','mount','wall'])if(Object.hasOwn(LABELS[key],raw[key]))s[key]=raw[key];
 if(typeof raw.text==='string')s.text=raw.text.replace(/[\u0000-\u0008\u000b-\u001f<>]/g,'').slice(0,60);
 for(const [key,min,max] of [['width',30,400],['depth',3,12],['spacing',0,20]])if(Number.isFinite(Number(raw[key])))s[key]=Math.min(max,Math.max(min,Number(raw[key])));
 for(const key of ['lightOn','night','railCustomColor'])if(typeof raw[key]==='boolean')s[key]=raw[key];
 if(COLORS.some(([value])=>value===raw.color))s.color=raw.color;
 for(const key of ['body','acrylic','plate','railColor'])if(/^#[\da-f]{6}$/i.test(raw[key]||''))s[key]=raw[key].toLowerCase();
 // Old front finishes become side paint colours; keep rear finishes and paint
 // independent. The former finish field is no longer part of the v3 contract.
 let legacyFront='brushed-steel';
 if(raw.version===1){
  const previous={'#a8adb1':'brushed-steel','#b8995b':'brushed-gold'}[s.body]||'painted-steel';legacyFront=previous;s.backFinish=previous;
  if(s.lighting==='front'&&COLORS.some(([value])=>value===raw.color))s.acrylic=raw.color;
 }
 if(Object.hasOwn(FINISHES,raw.backFinish))s.backFinish=raw.backFinish;
 if([1,2].includes(raw.version)){if(Object.hasOwn(FINISHES,raw.frontFinish))legacyFront=raw.frontFinish;s.sideColor=FINISHES[legacyFront].color||s.body;}
 if(/^#[\da-f]{6}$/i.test(raw.sideColor||''))s.sideColor=raw.sideColor.toLowerCase();
 for(const [key,field] of Object.entries(PAINT_FIELDS)){
  const code=ralCode(raw[field]);if(code){s[field]=`RAL ${code}`;s[key]=RAL_COLORS[code].hex;}
 }
 return s;
}
export function validate(s){
 const paintKeys=[s.lighting==='front'?'sideColor':s.backFinish==='painted-steel'?'body':null,s.mount==='plate'?'plate':null,s.mount==='rail'&&s.railCustomColor?'railColor':null].filter(Boolean);
 for(const key of paintKeys)if(s[PAINT_FIELDS[key]]&&!ralCode(s[PAINT_FIELDS[key]]))return 'Bitte einen gültigen RAL-CLASSIC-Ton wählen, z. B. RAL 7016, oder die RAL-Eingabe leeren.';
 if(!s.text.trim())return 'Gib einen Schriftzug oder einen einzelnen Buchstaben ein.';
 if(s.text.split('\n').length>2)return 'Bitte verwende höchstens zwei Zeilen.';
 if(s.text.length>60)return 'Bitte verwende höchstens 60 Zeichen.';
 if(!Number.isFinite(s.width)||s.width<30||s.width>400)return 'Gib eine Wunschbreite zwischen 30 und 400 cm ein.';
 return '';
}
export function description(s,height){return [
 '3D-Leuchtbuchstaben – Konfiguration',`Text: ${s.text}`,`Schrift: ${LABELS.font[s.font]}`,`Lichtart: ${LABELS.lighting[s.lighting]}`,`Montage: ${LABELS.mount[s.mount]}`,
 `Schriftzug: ${s.width} cm breit${height?`, ca. ${height.toLocaleString('de-DE',{maximumFractionDigits:1})} cm hoch`:''}`,`Wunschtiefe: ${s.depth} cm`,
 s.lighting==='front'?`Leuchtfarbe vorne: ${ACRYLICS.find(c=>c[0]===s.acrylic)?.[1]||'Eigene Farbe'} (${s.acrylic.toUpperCase()}) · Acrylfront`:`Front und Korpus: ${finishDescription(s)}`,
 s.lighting==='front'?`Korpus: Edelstahl · ${finishDescription(s)}`:`Lichtfarbe (Halo): ${COLORS.find(c=>c[0]===s.color)?.[1]}`,
 s.lighting==='front'?'LEDs innen, Lichtaustritt durch die Acrylfront.':'Rückseite: ca. 1 cm weißes, opales Acryl in Buchstabenform mit innenliegenden LEDs. Lichtaustritt nach hinten zur Wand.',s.mount==='plate'?`Lackfarbe der Platte: ${paintDescription(s,'plate')}`:'',s.mount==='rail'?`Schiene: ${s.railCustomColor?'Wunschfarbe '+paintDescription(s,'railColor'):'Standardausführung'} · ${(s.width/100).toLocaleString('de-DE')} m lang`:'',
 'Maße und Ausführung sind Entwurfswünsche und vor Fertigung zu prüfen.'
 ].filter(Boolean).join('\n');}
