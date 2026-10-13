// Selected variant 1. All quotes and selections go through the live configurator.
const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';
const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n);
const decimal=n=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Use the same built-in font list and pricing path as the main configurator.
// Prefer visibly different examples when several fonts have the same real tariff.
const previewOrder=['Alexa','NeonLite','Mayfair'];
export function selectBudgetQuotes(quotes,budget){
 const eligible=quotes.filter(q=>q?.price?.status==='calculated'&&Number.isFinite(q.gross)&&q.gross<=budget)
  .sort((a,b)=>a.gross-b.gross);
 const distinct=eligible.filter((q,i)=>!i||Math.round(q.gross*100)!==Math.round(eligible[i-1].gross*100));
 const chosen=[];
 if(distinct.length){
  chosen.push(distinct[0]);
  if(distinct.length>2){
   const midpoint=(distinct[0].gross+distinct.at(-1).gross)/2;
   chosen.push(distinct.slice(1,-1).reduce((best,q)=>Math.abs(q.gross-midpoint)<Math.abs(best.gross-midpoint)?q:best));
  }
  if(distinct.length>1)chosen.push(distinct.at(-1));
 }
 for(const q of eligible)if(chosen.length<3&&!chosen.includes(q))chosen.push(q);
 return chosen.sort((a,b)=>a.gross-b.gross);
}
let svgId=0;
function neonPreview(quote,color){
 const id='budget-glow-'+(++svgId),b=quote.result.layout.bounds;
 const paths=quote.result.layout.glyphs.map(g=>`<path d="${escape(g.centerlineD)}"/>`).join('');
 const light=color==='rgb'?'url(#'+id+'-rgb)':color;
 return `<svg class="nt-budget-neon" role="img" aria-label="${escape(quote.design.text)} in ${quote.design.fontId}${color==='rgb'?' – RGB-Farbbeispiel':''}" viewBox="-40 -40 ${b.width+80} ${b.height+80}"><defs><filter id="${id}" x="-40%" y="-150%" width="180%" height="400%"><feGaussianBlur stdDeviation="9"/></filter><linearGradient id="${id}-rgb"><stop stop-color="#ff58d4"/><stop offset=".5" stop-color="#618bff"/><stop offset="1" stop-color="#64ffd0"/></linearGradient></defs><g fill="none" stroke="${light}" stroke-width="14" opacity=".65" filter="url(#${id})">${paths}</g><g fill="none" stroke="${light}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${paths}</g><g fill="none" stroke="#fff7ff" stroke-width="3" opacity=".9" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}
export function initBudgetAdvisor(root,api){
 if(!root)return;
 const fonts=[...new Set([...previewOrder.filter(id=>api.fonts.includes(id)),...api.fonts])];
 const colors=[...api.colors,{id:'rgb',name:'RGB-Farbwechsel',color:'rgb'}];
 let committed={...api.initial},revision=0,results=[],started=false;
 let contextKey=api.contextKey(),resultContextKey=null;
 const cache=new Map();
 root.dataset.editing='false';root.dataset.state='idle';root.dataset.priceVersion=api.priceVersion;
 root.innerHTML=`<div class="nt-budget-inner">
 <div class="nt-budget-heading"><div><p class="nt-budget-kicker">DEIN PREISRECHNER</p><h2 id="budget-title">Dein Text. Dein Budget.</h2></div><p class="nt-budget-intro">Vergleiche bis zu drei Looks für deinen<br class="nt-budget-desktop-break"> Wunschtext – passend zu Größe und Budget.</p></div>
 <button class="nt-budget-wishes" type="button" aria-expanded="false" aria-controls="budget-form"><span><strong data-budget-text></strong><small data-budget-summary></small></span><span>Ändern ${arrow}</span></button>
 <form id="budget-form" class="nt-budget-form">
 <label class="nt-budget-text"><span>Dein Wunschtext</span><textarea name="text" rows="1" maxlength="160" required aria-label="Dein Wunschtext"></textarea></label>
 <label><span>Wunschbreite (cm)</span><input name="width" type="number" inputmode="decimal" min="50" max="400" step="0.1" required></label>
 <label><span>Max. Budget (€)</span><input name="budget" type="number" inputmode="decimal" min="1" max="100000" step="0.01" required></label>
 <label class="nt-budget-color"><span>Leuchtfarbe</span><select name="color">${colors.map(c=>`<option value="${c.id}">${escape(c.name)}</option>`).join('')}</select></label>
 <button class="nt-budget-action nt-budget-search" type="submit">Looks finden ${arrow}</button>
 <button class="nt-budget-back" type="button">Zurück zu deinen Vorschlägen</button>
 </form>
 <div class="nt-budget-results"><p class="nt-budget-status" role="status" aria-live="polite">Deine Vorschläge werden berechnet, sobald du hier bist.</p><div class="nt-budget-grid" aria-label="Schriftvorschläge"></div></div><p class="nt-budget-included">Inklusive MwSt. und deiner gewählten Ausstattung. Eilauftrag und Express werden im Warenkorb ergänzt.</p>
 </div>`;
 const $=s=>root.querySelector(s),form=$('form'),grid=$('.nt-budget-grid'),status=$('.nt-budget-status'),search=$('.nt-budget-search'),wishes=$('.nt-budget-wishes');
 const nameFor=id=>colors.find(c=>c.id===id)?.name||id;
 function restore(){for(const [name,value] of Object.entries(committed))form.elements[name].value=value;form.elements.text.setCustomValidity('');}
 function summary(){ $('[data-budget-text]').textContent=committed.text;$('[data-budget-summary]').textContent=`${decimal(committed.width)} cm · ${nameFor(committed.color)} · max. ${money(committed.budget)}`; }
 function editing(value){root.dataset.editing=String(value);wishes.setAttribute('aria-expanded',String(value));if(value)form.elements.text.focus({preventScroll:true});else if(matchMedia('(max-width:760px)').matches)wishes.focus({preventScroll:true});if(matchMedia('(max-width:760px)').matches)root.scrollIntoView({block:'start',behavior:'instant'});}
 function stale(message='Wünsche geändert – bitte neu berechnen.'){revision++;root.dataset.state='stale';search.disabled=false;grid.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=message;}
 function showQuotes(quotes,input){
  results=selectBudgetQuotes(quotes,input.budget);grid.replaceChildren();root.dataset.resultCount=results.length;
  const samePrice=results.length>1&&new Set(results.map(q=>Math.round(q.gross*100))).size===1;
  status.textContent=results.length?(samePrice?`${results.length} Looks zum gleichen Preis · inkl. MwSt.`:`${results.length} ${results.length===1?'Look passt':'Looks passen'} in dein Budget · inkl. MwSt.`):'Noch kein passender Look in deinem Budget.';
  for(const [index,q] of results.entries()){
   const card=document.createElement('article');card.className='nt-budget-card';card.dataset.budgetFont=q.design.fontId;card.dataset.gross=q.gross;
   const color=input.color==='rgb'?'rgb':colors.find(c=>c.id===input.color).color;
   card.innerHTML=`<div class="nt-budget-scene"><img class="nt-budget-brand" src="${escape(api.logoUrl||'assets/logo-white.svg')}" alt="" aria-hidden="true" width="83" height="18">${neonPreview(q,color)}</div><div class="nt-budget-card-info"><div class="nt-budget-font"><h3>${q.design.fontId}</h3><p>${decimal(q.size.widthMm/10)} × ${decimal(q.size.heightMm/10)} cm</p></div><div class="nt-budget-price"><span>Schildpreis inkl. MwSt.</span><strong>${money(q.gross)}</strong></div></div><button class="nt-budget-action" type="button" data-budget-choose="${index}" aria-label="${q.design.fontId} für ${money(q.gross)} im Konfigurator wählen">Wählen ${arrow}</button>`;
   grid.append(card);
  }
  if(!results.length){
   const valid=quotes.filter(q=>q?.gross!=null),minimum=valid.length?Math.min(...valid.map(q=>q.gross)):null;
   const empty=document.createElement('div');empty.className='nt-budget-empty';
   const geometryHint=quotes.find(q=>q?.price?.reasons?.length);
   const text=document.createElement('p');text.textContent=minimum!==null?`Die günstigste passende Schrift kostet bei ${decimal(input.width)} cm ${money(minimum)}. Erhöhe dein Budget oder probiere eine kleinere Breite.`:`Für deinen Text gibt es bei dieser Breite noch keinen passenden Vorschlag.${geometryHint?' Zum Beispiel '+geometryHint.design.fontId+': '+geometryHint.price.reasons[0]:' Bitte Text oder Breite anpassen.'}`;
   const change=document.createElement('button');change.type='button';change.className='nt-budget-action';change.textContent='Wünsche ändern';change.addEventListener('click',()=>{editing(true);form.elements[minimum!==null?'budget':'width'].focus({preventScroll:true});});empty.append(text,change);grid.append(empty);
  }
 }
 function measure(outcome){try{api.track?.(outcome);}catch{}}
 async function calculate(userInitiated=false){
  const text=form.elements.text.value.trim();form.elements.text.setCustomValidity(!text?'Bitte gib deinen Wunschtext ein.':text.split('\n').length>5?'Bitte höchstens fünf Zeilen verwenden.':'');
  if(!form.reportValidity())return;
  if(userInitiated)measure('started');
  const input={text,width:Number(form.elements.width.value),budget:Number(form.elements.budget.value),color:form.elements.color.value};
  contextKey=api.contextKey();const quoteContextKey=contextKey;
  const id=++revision,isCurrent=()=>id===revision&&quoteContextKey===api.contextKey();started=true;root.dataset.state='pending';search.disabled=true;grid.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Wir berechnen deine Schriftvorschläge …';
  try{
   const quotes=[];let failures=0;root.dataset.checkedFonts='0';
   for(const font of fonts){
    if(!isCurrent())return;
    const key=JSON.stringify([input.text,input.width,input.color,font,api.priceVersion,quoteContextKey]);
    try{let q=cache.get(key);if(!q){q=await api.quote(input,font,isCurrent);if(q&&isCurrent()){if(cache.size>72)cache.delete(cache.keys().next().value);cache.set(key,q);}}if(q)quotes.push(q);}
    catch{failures++;}
    if(isCurrent()){root.dataset.checkedFonts=String(quotes.length+failures);status.textContent=`Wir prüfen ${quotes.length+failures} von ${fonts.length} Schriften …`;}
   }
   if(!isCurrent())return;
   if(!quotes.length&&failures)throw new Error('Schriften konnten nicht geladen werden. Bitte erneut versuchen.');
   resultContextKey=quoteContextKey;committed=input;summary();showQuotes(quotes,input);root.dataset.state='ready';
   if(userInitiated)measure(results.length?'results':'empty');
   if(failures)status.textContent+=' Einige Schriften konnten nicht geladen werden.';
   const wasEditing=root.dataset.editing==='true';root.dataset.editing='false';wishes.setAttribute('aria-expanded','false');if(wasEditing&&matchMedia('(max-width:760px)').matches){document.activeElement?.blur();wishes.focus({preventScroll:true});root.scrollIntoView({block:'start',behavior:'instant'});}
  }catch(error){if(isCurrent()){if(userInitiated)measure('error');root.dataset.state='error';status.textContent=error.message||'Die Berechnung ist gerade nicht verfügbar. Bitte erneut versuchen.';}}
  finally{if(isCurrent())search.disabled=false;}
 }
 form.addEventListener('submit',event=>{event.preventDefault();calculate(event.isTrusted);});
 form.addEventListener('input',()=>{form.elements.text.setCustomValidity('');stale();});
 form.addEventListener('change',()=>{if(root.dataset.state!=='stale')stale();});
 wishes.addEventListener('click',()=>editing(true));
 $('.nt-budget-back').addEventListener('click',event=>{restore();editing(false);calculate(event.isTrusted);});
 grid.addEventListener('click',async event=>{
  const button=event.target.closest('[data-budget-choose]');if(!button||button.disabled||root.dataset.state!=='ready')return;
  if(resultContextKey!==api.contextKey()){refreshContext();return;}
  const q=results[Number(button.dataset.budgetChoose)],id=revision;root.dataset.state='applying';grid.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Dein Look wird in den Konfigurator übernommen …';
  try{const selection=await api.choose(q);if(revision===id){measure('applied');root.dataset.state='ready';status.textContent=selection?.message||`${q.design.fontId} ist im Konfigurator ausgewählt.`;}}
  catch(error){if(revision===id){measure('error');root.dataset.state='ready';status.textContent=error.message;}}
  finally{if(revision===id)grid.querySelectorAll('button').forEach(b=>b.disabled=false);}
 });
 function refreshContext(){
  const next=api.contextKey();if(next===contextKey)return;
  contextKey=next;cache.clear();stale('Ausstattung geändert – wir aktualisieren deine Vorschläge.');
  if(started&&root.dataset.editing!=='true')calculate();
 }
 restore();summary();
 if(location.hash==='#config-budget')root.scrollIntoView({block:'start'});
 const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!started){observer.disconnect();calculate();}},{rootMargin:'300px'});observer.observe(root);
 return {refreshContext};
}
