// Entry assistance is deliberately separate from product/draft data.
export function createDraftWriteGuard(){
  let blocked=false;
  return {block(){blocked=true;},release(){blocked=false;},get blocked(){return blocked;},write(save,snapshot){if(blocked)return false;save(snapshot);return true;}};
}

export function initEntryOnboarding({field,label,getView,navigate,restore,storage=()=>localStorage}){
  const key='neontrip-entry-help-dismissed-v1';
  const $=selector=>document.querySelector(selector);
  const mobile=matchMedia('(max-width:760px)');
  let eligible=false,dismissed=false,step=0,view=null,returnFocus=null,pending=false,frame=0,targets=[],viewScroll=0;
  try{dismissed=storage().getItem(key)==='1';}catch{}
  const restart=document.createElement('button');
  restart.type='button';restart.id='entry-tour-restart';restart.title='Kurze Einführung';
  restart.setAttribute('aria-label','Kurze Einführung starten');
  restart.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.8-2.5 1.8-2.5 3.5M12 17h.01"/></svg>';
  label.after(restart);
  const layer=document.createElement('div');layer.id='entry-tour';layer.hidden=true;
  layer.innerHTML=`<div class="entry-tour-shade" aria-hidden="true"></div><div class="entry-tour-shade" aria-hidden="true"></div><div class="entry-tour-shade" aria-hidden="true"></div><div class="entry-tour-shade" aria-hidden="true"></div>
    <div class="entry-tour-spot" aria-hidden="true"></div>
    <section class="entry-tour-card" role="dialog" aria-labelledby="entry-tour-title" aria-describedby="entry-tour-copy" tabindex="-1">
      <div class="entry-tour-top"><span id="entry-tour-progress"></span><button type="button" data-tour-close aria-label="Einführung schließen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
      <h2 id="entry-tour-title"></h2><p id="entry-tour-copy"></p>
      <div class="entry-tour-actions"><button type="button" data-tour-skip>Überspringen</button><button type="button" data-tour-back hidden>Zurück</button><span class="entry-tour-dots" aria-hidden="true"><i></i><i></i><i></i></span><button type="button" data-tour-next>Weiter <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div>
    </section>`;
  document.body.append(layer);
  const card=layer.querySelector('.entry-tour-card'),spot=layer.querySelector('.entry-tour-spot');
  const shades=[...layer.querySelectorAll('.entry-tour-shade')];
  const next=layer.querySelector('[data-tour-next]'),back=layer.querySelector('[data-tour-back]');
  const copy=[
    ['Dein Text. Dein Neon.','Gib hier deinen Wunschtext ein. Die Vorschau passt sich sofort an.'],
    ['Finde deinen Look.','Wähle deine Schrift und Leuchtfarbe. Probiere aus, was zu dir passt.'],
    ['Deine Größe. Dein Preis.','Wähle deine Wunschgröße. Den passenden Gesamtpreis siehst du direkt unten.']
  ];
  function remember(){dismissed=true;try{storage().setItem(key,'1');}catch{}}
  function visible(node){return node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';}
  function resolveTargets(){
    const selectors=step===0?['.studio-motif-heading','.studio-text-frame']:step===1?(mobile.matches?['.studio-mobile-look']:['.studio-fonts','.studio-colors']):['.custom-size-entry'];
    return selectors.map($).filter(visible);
  }
  function bounds(){
    targets=resolveTargets();if(!targets.length)return null;
    const r=targets.map(n=>n.getBoundingClientRect());
    return {left:Math.min(...r.map(x=>x.left))-6,top:Math.min(...r.map(x=>x.top))-6,right:Math.max(...r.map(x=>x.right))+6,bottom:Math.max(...r.map(x=>x.bottom))+6};
  }
  function box(node,x,y,w,h){Object.assign(node.style,{left:x+'px',top:y+'px',width:Math.max(0,w)+'px',height:Math.max(0,h)+'px'});}
  function position(){
    frame=0;if(layer.hidden)return;
    const r=bounds();if(!r)return close({restoreView:true});
    const w=document.documentElement.clientWidth,h=window.innerHeight,gap=18;
    const l=Math.max(0,Math.min(w,r.left)),t=Math.max(0,Math.min(h,r.top)),right=Math.max(l,Math.min(w,r.right)),bottom=Math.max(t,Math.min(h,r.bottom));
    box(shades[0],0,0,w,t);box(shades[1],0,t,l,bottom-t);box(shades[2],right,t,w-right,bottom-t);box(shades[3],0,bottom,w,h-bottom);
    box(spot,l,t,right-l,bottom-t);
    card.style.width=Math.min(410,w-24)+'px';
    const cw=card.offsetWidth,ch=card.offsetHeight;
    let x,y,side;
    if(w-right>=cw+gap+12){x=right+gap;y=Math.max(12,Math.min(t-60,h-ch-12));side='left';}
    else if(t>=ch+gap){x=Math.max(12,Math.min(l,w-cw-12));y=t-ch-gap;side='bottom';}
    else {x=Math.max(12,Math.min(l,w-cw-12));y=bottom+gap;side='top';}
    card.dataset.arrow=side;
    card.style.left=x+'px';card.style.top=Math.max(12,Math.min(y,h-ch-12))+'px';
    card.style.setProperty('--arrow-position',side==='left'?Math.max(24,Math.min((t+bottom)/2-y,ch-24))+'px':Math.max(24,Math.min((l+right)/2-x,cw-24))+'px');
  }
  function schedule(){if(!frame&&!layer.hidden)frame=requestAnimationFrame(position);}
  function ensureRoom(){
    const r=bounds();if(!r)return;
    const ch=card.offsetHeight,h=innerHeight;
    if(mobile.matches){
      // Leave the card above the highlighted control and the fixed price below it.
      const desired=ch+30;
      const current=r.top;
      if(current<desired||r.bottom>h-115)window.scrollBy({top:current-desired,behavior:'instant'});
    }else {
      const price=$('.design-price').getBoundingClientRect();
      const end=Math.max(r.bottom,price.bottom);
      if(end>h-16&&end-r.top<h-32)window.scrollBy({top:end-h+16,behavior:'instant'});
      else if(r.top<12||r.bottom>h-20)targets[0].scrollIntoView({block:'center',behavior:'instant'});
    }
    position();
  }
  function showStep(index){
    step=index;navigate(step);
    layer.querySelector('#entry-tour-progress').textContent=`SCHRITT ${step+1} VON 3`;
    layer.querySelector('#entry-tour-title').textContent=copy[step][0];
    layer.querySelector('#entry-tour-copy').textContent=copy[step][1];
    back.hidden=step===0;
    next.firstChild.textContent=step===2?'Los geht’s ':'Weiter ';
    [...layer.querySelectorAll('.entry-tour-dots i')].forEach((dot,i)=>dot.classList.toggle('is-current',i===step));
    layer.dataset.step=String(step+1);layer.hidden=false;
    card.style.width=Math.min(410,document.documentElement.clientWidth-24)+'px';
    position();card.focus({preventScroll:true});
    requestAnimationFrame(()=>{if(!layer.hidden){ensureRoom();}});
  }
  function open(){
    if(!layer.hidden||!visible(field)||field.closest('[inert]'))return;
    pending=false;view=getView();viewScroll=window.scrollY;returnFocus=document.activeElement;
    document.body.classList.add('entry-tour-active');showStep(0);remember();
  }
  function close({restoreView=false,focus=true}={}){
    if(layer.hidden)return;
    layer.hidden=true;document.body.classList.remove('entry-tour-active');
    if(restoreView&&view){restore(view);requestAnimationFrame(()=>window.scrollTo({top:viewScroll,behavior:'instant'}));}
    if(focus){const target=visible(returnFocus)&&returnFocus!==document.body?returnFocus:restart;target.focus({preventScroll:true});}
    remember();
  }
  const select=()=>{if(!eligible)return;eligible=false;field.focus({preventScroll:true});field.select();};
  field.addEventListener('pointerdown',event=>{if(eligible&&event.button===0){event.preventDefault();close({focus:false});select();}});
  field.addEventListener('focus',()=>{pending=false;remember();close({focus:false});select();});
  field.addEventListener('input',()=>{eligible=false;pending=false;close({focus:false});remember();});
  // Selecting a real control is always a direct exit; no tutorial clicks are required.
  document.addEventListener('pointerdown',event=>{
    if(pending&&event.target.closest('.editor,.preview-column')){pending=false;remember();}
    if(!layer.hidden&&event.target!==restart&&!restart.contains(event.target)&&targets.some(node=>node.contains(event.target)))close({focus:false});
  },true);
  restart.addEventListener('click',()=>{if(layer.hidden)open();else close({restoreView:true});});
  layer.querySelector('[data-tour-close]').addEventListener('click',()=>close({restoreView:true}));
  layer.querySelector('[data-tour-skip]').addEventListener('click',()=>close({restoreView:true}));
  next.addEventListener('click',()=>{if(step<2)showStep(step+1);else{navigate(0);close({focus:false});requestAnimationFrame(()=>window.scrollTo({top:viewScroll,behavior:'instant'}));label.tabIndex=-1;label.focus({preventScroll:true});}});
  back.addEventListener('click',()=>showStep(step-1));
  document.addEventListener('keydown',event=>{
    if(layer.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close({restoreView:true});}
    if(event.key==='Tab'){
      const all=[...targets.flatMap(n=>[...n.querySelectorAll('button, input, textarea, select, summary, [tabindex="0"]')]),...card.querySelectorAll('button')].filter(n=>visible(n)&&!n.disabled&&n.tabIndex>=0);
      const unique=[...new Set(all)],at=unique.indexOf(document.activeElement);
      const index=at<0?(event.shiftKey?unique.length-1:0):(at+(event.shiftKey?-1:1)+unique.length)%unique.length;
      event.preventDefault();unique[index]?.focus({preventScroll:true});
    }
  },true);
  // A keyboard user activating a highlighted control gets the same direct exit.
  document.addEventListener('click',event=>{if(!layer.hidden&&targets.some(node=>node.contains(event.target))&&event.target!==restart&&!restart.contains(event.target))close({focus:false});},true);
  window.addEventListener('resize',()=>{if(!layer.hidden){navigate(step);requestAnimationFrame(ensureRoom);}});
  window.addEventListener('scroll',schedule,true);
  window.visualViewport?.addEventListener('resize',schedule);
  const observer=new ResizeObserver(schedule);observer.observe($('.editor'));observer.observe(card);
  function blocked(){return !!document.querySelector('[data-nt-splash]')||!!document.querySelector('dialog[open]')||window.Cookiebot?.dialog?.visible||visible($('#CybotCookiebotDialog'));}
  function autoStart(){if(!pending||dismissed)return;if(blocked())return;open();}
  for(const name of ['CookiebotOnAccept','CookiebotOnDecline','CookiebotOnDialogDisplay','CookiebotOnDialogInit'])window.addEventListener(name,()=>{
    if(name==='CookiebotOnDialogDisplay'){if(!layer.hidden)close({restoreView:true});return;}
    requestAnimationFrame(autoStart);
  });
  return {
    start(fresh){eligible=!!fresh;pending=!!fresh&&!dismissed;setTimeout(autoStart,1800);},
    end(){eligible=false;pending=false;close({focus:false});}
  };
}
