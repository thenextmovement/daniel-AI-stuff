import {RAL_COLORS,RAL_GROUPS,ralCode,searchRal} from './ral.js?v=23';

// One shared picker for every painted part. Search text stays local to the
// picker; only a real catalogue selection becomes a saved paint specification.
export function createRalPicker({host,id,label,onSelect,onClear,onPendingChange}){
 host.innerHTML=`<label class="field-label" for="${id}-ral">RAL-Ton <span>optional</span></label><div class="ral-search"><input id="${id}-ral" class="ral-input" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-ral-list" placeholder="Nummer oder Farbname suchen" maxlength="60" autocomplete="off" spellcheck="false" aria-label="RAL-Ton ${label}" aria-describedby="${id}-ral-note ${id}-ral-preview"><button type="button" class="ral-toggle" aria-label="RAL-Farben ${label} anzeigen" aria-expanded="false" aria-controls="${id}-ral-list">⌄</button></div><div class="ral-results" hidden><div class="ral-groups" role="group" aria-label="Farbgruppe ${label}"></div><p class="ral-count" role="status"></p><div id="${id}-ral-list" class="ral-list" role="listbox" aria-label="RAL-Farbtöne ${label}"></div><p class="ral-empty" hidden>Kein passender RAL-Ton. Versuche eine andere Nummer oder einen Farbnamen.</p></div><div class="ral-selection" hidden><span class="ral-chip" aria-hidden="true"></span><span class="ral-selection-text"><strong></strong><small></small></span><button type="button" id="${id}-clear-ral" class="ral-clear" aria-label="RAL-Auswahl ${label} entfernen">×</button></div><p id="${id}-ral-note" class="field-hint"></p><p id="${id}-ral-preview" class="field-hint ral-preview-note">RAL-Bildschirmfarben sind Näherungen. Für den Lack gilt der gewählte RAL-Ton.</p>`;
 const input=host.querySelector('input'),toggle=host.querySelector('.ral-toggle'),panel=host.querySelector('.ral-results'),list=host.querySelector('.ral-list'),count=host.querySelector('.ral-count'),empty=host.querySelector('.ral-empty'),selection=host.querySelector('.ral-selection'),note=host.querySelector('#'+id+'-ral-note');
 let selected='',open=false,pending=false,query='',group='all',matches=[],active=-1;
 const groups=host.querySelector('.ral-groups');
 for(const colourGroup of RAL_GROUPS){
  const button=document.createElement('button');button.type='button';button.className='ral-group';button.dataset.group=colourGroup.id;button.setAttribute('aria-pressed',String(colourGroup.id===group));
  if(colourGroup.hex){const dot=document.createElement('span');dot.className='ral-group-dot';dot.style.background=colourGroup.hex;dot.setAttribute('aria-hidden','true');button.append(dot);}
  button.append(document.createTextNode(colourGroup.name));button.addEventListener('click',()=>{group=colourGroup.id;renderList();});groups.append(button);
 }
 const notifyPending=value=>{if(pending!==value){pending=value;onPendingChange();}};
 function selectionView(){
  selection.hidden=!selected;
  if(selected){selection.querySelector('.ral-chip').style.background=RAL_COLORS[selected].hex;selection.querySelector('strong').textContent=RAL_COLORS[selected].name;selection.querySelector('small').textContent='RAL '+selected;}
  note.textContent=pending?'Wähle einen Farbton aus den Treffern.':selected?'Für deine Lackierung ausgewählt.':'Nach RAL-Nummer oder Farbname suchen.';
  input.setAttribute('aria-invalid',String(pending&&matches.length===0));
 }
 function markActive(index){
  active=index;
  const options=[...list.children];options.forEach((option,i)=>option.classList.toggle('is-active',i===active));
  if(options[active]){input.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
 }
 function renderList(){
  matches=searchRal(query,group);
  for(const button of groups.children)button.setAttribute('aria-pressed',String(button.dataset.group===group));
  empty.textContent=group==='all'?'Kein passender RAL-Ton. Versuche eine andere Nummer oder einen Farbnamen.':'Kein Treffer in dieser Farbgruppe. Wähle „Alle“ oder ändere deine Suche.';
  list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
  if(!query.trim()&&selected)matches.sort(([a],[b])=>Number(b===selected)-Number(a===selected));
  count.textContent=matches.length===1?'1 Farbton':`${matches.length} Farbtöne`;empty.hidden=matches.length>0;
  for(const [code,colour] of matches){
   const option=document.createElement('button');option.type='button';option.className='ral-option';option.id=`${id}-ral-option-${code}`;option.tabIndex=-1;option.setAttribute('role','option');option.setAttribute('aria-selected',String(code===selected));option.setAttribute('aria-label',`${colour.name} · RAL ${code}`);
   const chip=document.createElement('span');chip.className='ral-chip';chip.style.background=colour.hex;chip.setAttribute('aria-hidden','true');
   const text=document.createElement('span'),name=document.createElement('strong'),number=document.createElement('small'),check=document.createElement('span');name.textContent=colour.name;number.textContent='RAL '+code;text.className='ral-option-text';text.append(name,number);check.className='ral-check';check.textContent=code===selected?'✓':'';check.setAttribute('aria-hidden','true');option.append(chip,text,check);
   // Keep keyboard focus on the combobox; touch scrolling remains native.
   option.addEventListener('mousedown',event=>event.preventDefault());option.addEventListener('click',()=>choose(code));list.append(option);
  }
  list.scrollTop=0;selectionView();
 }
 function show(search=''){
  query=search;input.value=search;open=true;panel.hidden=false;input.setAttribute('aria-expanded','true');toggle.setAttribute('aria-expanded','true');renderList();
 }
 function close(){
  open=false;panel.hidden=true;input.setAttribute('aria-expanded','false');toggle.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
  input.value=selected?'RAL '+selected:'';query='';group='all';notifyPending(false);selectionView();
 }
 function choose(code){
  selected=code;input.value='RAL '+code;notifyPending(false);onSelect('RAL '+code);input.focus({preventScroll:true});close();
 }
 input.addEventListener('focus',()=>{if(!open){show();input.select();}});
 input.addEventListener('click',()=>{if(!open)show();});
 toggle.addEventListener('click',()=>{if(open){close();return;}input.focus({preventScroll:true});show();});
 input.addEventListener('input',()=>{
  const value=input.value.trim(),code=ralCode(value);query=value;
  if(code){group='all';selected=code;notifyPending(false);onSelect('RAL '+code);}
  else if(!value)notifyPending(false);
  else notifyPending(true);
  show(value);
 });
 input.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();if(!open)show();const direction=event.key==='ArrowDown'?1:-1;
   if(matches.length)markActive(active<0?(direction===1?0:matches.length-1):(active+direction+matches.length)%matches.length);
  }else if(event.key==='Enter'&&open){
   event.preventDefault();const choice=matches[active>=0?active:matches.length===1?0:-1];if(choice)choose(choice[0]);
  }
 });
 host.addEventListener('keydown',event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();input.focus({preventScroll:true});close();}});
 host.addEventListener('focusout',event=>{if(!host.contains(event.relatedTarget))close();});
 host.querySelector('.ral-clear').addEventListener('click',()=>{selected='';input.value='';notifyPending(false);onClear();close();});
 return {
  sync(value){selected=ralCode(value);if(!open&&!pending)input.value=selected?'RAL '+selected:'';selectionView();if(open&&!pending)renderList();},
  get pending(){return pending&&host.getClientRects().length>0;}
 };
}
