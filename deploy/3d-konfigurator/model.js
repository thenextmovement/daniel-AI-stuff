export const DEFAULT = Object.freeze({version:1,text:'ATLAS',font:'modern',lighting:'front',mount:'individual',width:120,depth:5,color:'#fff1d6',body:'#252525',plate:'#d8d0c4',wall:'warm',lightOn:true,night:false,spacing:5});
export const LABELS={font:{modern:'Modern',classic:'Klassisch',elegant:'Elegant'},lighting:{front:'Frontbeleuchtet',back:'Rückbeleuchtet'},mount:{individual:'Einzelbuchstaben',rail:'Auf Schiene',plate:'Auf Platte'},wall:{warm:'Putz',concrete:'Beton',dark:'Anthrazit'}};
export const COLORS=[['#fff1d6','Warmweiß'],['#f5f7ff','Weiß'],['#f5c35b','Goldgelb'],['#fc6fa8','Rosa'],['#80baff','Blau'],['#8bdfb1','Grün']];
export const BODIES=[['#252525','Anthrazit'],['#e4e1db','Weiß'],['#a8adb1','Silber'],['#b8995b','Gold']];
export function normalize(raw={}){
 const s={...DEFAULT};
 for(const key of ['font','lighting','mount','wall'])if(Object.hasOwn(LABELS[key],raw[key]))s[key]=raw[key];
 if(typeof raw.text==='string')s.text=raw.text.replace(/[\u0000-\u0008\u000b-\u001f<>]/g,'').slice(0,60);
 for(const [key,min,max] of [['width',30,400],['depth',3,12],['spacing',0,20]])if(Number.isFinite(Number(raw[key])))s[key]=Math.min(max,Math.max(min,Number(raw[key])));
 for(const key of ['lightOn','night'])if(typeof raw[key]==='boolean')s[key]=raw[key];
 for(const [key,choices] of [['color',COLORS],['body',BODIES]])if(choices.some(([value])=>value===raw[key]))s[key]=raw[key];
 if(/^#[\da-f]{6}$/i.test(raw.plate||''))s.plate=raw.plate;
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
 `Lichtfarbe: ${COLORS.find(c=>c[0]===s.color)?.[1]}`,`Korpus: ${BODIES.find(c=>c[0]===s.body)?.[1]}`,s.mount==='plate'?`Plattenfarbe (Vorschau): ${s.plate}`:'',
 'Maße und Ausführung sind Entwurfswünsche und vor Fertigung zu prüfen.'
 ].filter(Boolean).join('\n');}
