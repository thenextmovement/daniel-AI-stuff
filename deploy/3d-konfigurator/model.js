export const DEFAULT = Object.freeze({version:2,text:'ATLAS',font:'modern',lighting:'back',mount:'individual',width:120,depth:5,color:'#fff1d6',acrylic:'#ffffff',backFinish:'brushed-gold',frontFinish:'brushed-steel',body:'#252525',plate:'#d8d0c4',railCustomColor:false,railColor:'#252525',wall:'warm',lightOn:true,night:false,spacing:5});
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
export const COLORS=[['#fff1d6','Warmweiß'],['#f5f7ff','Weiß'],['#f5c35b','Goldgelb'],['#fc6fa8','Rosa'],['#80baff','Blau'],['#8bdfb1','Grün']];
export const ACRYLICS=[['#ffffff','Weiß'],['#e62d38','Rot'],['#ff8b24','Orange'],['#ee67af','Rosa'],['#2474e5','Blau'],['#26a86b','Grün']];
export const FINISHES={
 'brushed-gold':{label:'Gold gebürstet',description:'Edelstahl, gebürstet und gold lackiert',color:'#c6a156',metalness:.8,roughness:.34,brushed:true},
 'brushed-steel':{label:'Edelstahl gebürstet',description:'Edelstahl, gebürstet in Natur',color:'#c5c9cc',metalness:1,roughness:.31,brushed:true},
 'mirror-steel':{label:'Edelstahl verspiegelt',description:'Edelstahl, poliert und verspiegelt',color:'#f0f2f4',metalness:1,roughness:.045,brushed:false},
 'painted-steel':{label:'Edelstahl lackiert',description:'Edelstahl, farbig lackiert',color:null,metalness:.15,roughness:.36,brushed:false}
};
export function activeFinish(s){return s.lighting==='front'?s.frontFinish:s.backFinish;}
export function finishDescription(s){const id=activeFinish(s);return FINISHES[id].description+(id==='painted-steel'?` (${s.body.toUpperCase()})`:'');}
export function lightColor(s){return s.lighting==='front'?s.acrylic:s.color;}
export function classicLook(s){
 return {...s,...(s.lighting==='front'?{frontFinish:DEFAULT.frontFinish,acrylic:DEFAULT.acrylic}:{backFinish:DEFAULT.backFinish,color:DEFAULT.color})};
}
export function materialSpec(s){
 const f=FINISHES[activeFinish(s)],shell={color:f.color||s.body,metalness:f.metalness,roughness:f.roughness,brushed:f.brushed};
 return {shell,rear:s.lighting==='back'?{color:'#ffffff',metalness:0,roughness:.4,brushed:false,emissive:s.lightOn?s.color:'#000000',emissiveIntensity:s.night?1.6:.75}:{...shell},face:s.lighting==='front'?{color:s.acrylic,metalness:0,roughness:.27,brushed:false,emissive:s.lightOn?s.acrylic:'#000000',emissiveIntensity:s.night?.8:.45}:{...shell,emissive:'#000000',emissiveIntensity:0}};
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
 // Existing v1 drafts keep their visible choices; only new designs use the gold halo default.
 if(raw.version===1){
  const previous={'#a8adb1':'brushed-steel','#b8995b':'brushed-gold'}[raw.body]||'painted-steel';s.frontFinish=previous;s.backFinish=previous;
  if(s.lighting==='front'&&COLORS.some(([value])=>value===raw.color))s.acrylic=raw.color;
 }
 for(const key of ['backFinish','frontFinish'])if(Object.hasOwn(FINISHES,raw[key]))s[key]=raw[key];
 return s;
}
export function validate(s){
 if(!s.text.trim())return 'Gib einen Schriftzug oder einen einzelnen Buchstaben ein.';
 if(s.text.split('\n').length>2)return 'Bitte verwende höchstens zwei Zeilen.';
 if(s.text.length>60)return 'Bitte verwende höchstens 60 Zeichen.';
 if(!Number.isFinite(s.width)||s.width<30||s.width>400)return 'Gib eine Wunschbreite zwischen 30 und 400 cm ein.';
 return '';
}
export function description(s,height){return [
 '3D-Leuchtbuchstaben – Konfiguration',`Text: ${s.text}`,`Schrift: ${LABELS.font[s.font]}`,`Lichtart: ${LABELS.lighting[s.lighting]}`,`Montage: ${LABELS.mount[s.mount]}`,
 `Schriftzug: ${s.width} cm breit${height?`, ca. ${height.toLocaleString('de-DE',{maximumFractionDigits:1})} cm hoch`:''}`,`Wunschtiefe: ${s.depth} cm`,
 s.lighting==='front'?`Front: farbiges Acryl (${s.acrylic.toUpperCase()})`:`Front und Korpus: ${finishDescription(s)}`,
 s.lighting==='front'?`Korpus und Rückseite: ${finishDescription(s)}`:`Lichtfarbe (Halo): ${COLORS.find(c=>c[0]===s.color)?.[1]}`,
 s.lighting==='front'?'LEDs innen, Lichtaustritt durch die Acrylfront.':'Rückseite: weißes, opales Acryl in Buchstabenform, von innen beleuchtet. Lichtaustritt nach hinten zur Wand.',s.mount==='plate'?`Plattenfarbe (Vorschau): ${s.plate}`:'',s.mount==='rail'?`Schiene: ${s.railCustomColor?'Wunschfarbe '+s.railColor.toUpperCase():'Standardausführung'} · ${(s.width/100).toLocaleString('de-DE')} m lang`:'',
 'Maße und Ausführung sind Entwurfswünsche und vor Fertigung zu prüfen.'
 ].filter(Boolean).join('\n');}
