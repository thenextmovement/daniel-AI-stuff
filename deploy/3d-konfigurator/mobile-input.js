// Mobile browsers may resize only the visual viewport when the keyboard opens.
// Keep our fixed actions inside it; let the browser handle pinch zoom normally.
export function inputViewport(layoutHeight, viewport){
 const zoomed=viewport&&Math.abs(viewport.scale-1)>.05;
 const top=zoomed?0:Math.max(0,viewport?.offsetTop||0);
 const height=zoomed?layoutHeight:Math.max(0,viewport?.height??layoutHeight);
 return {top,height,inset:Math.max(0,layoutHeight-top-height),zoomed:Boolean(zoomed)};
}
export function inputScrollDelta(rect,top,bottom){
 if(rect.top<top||rect.height>bottom-top)return rect.top-top;
 return rect.bottom>bottom?rect.bottom-bottom:0;
}

export function initMobileInput({onLayout=()=>{},win=window,doc=document}={}){
 const body=doc.body,root=doc.documentElement,footer=doc.querySelector('.control-footer');
 const layout=win.matchMedia('(max-width:979px)'),viewport=win.visualViewport;
 let field=null,mode='',ending=false,afterEnd=null,frame=0,blurTimer=0,endTimer=0;
 let baseline=win.innerHeight,width=win.innerWidth,hadKeyboard=false,ensurePending=false;
 const editable=element=>element?.matches('textarea,input[type="text"],input[type="number"],input[type="search"]')&&!element.disabled&&!element.readOnly&&element.closest('.controls,#cart')?element:null;
 const visible=element=>element?.getClientRects().length>0;
 const scrollBy=(element,delta)=>{if(Math.abs(delta)>.5)(element.closest('dialog')||win).scrollBy({top:delta,behavior:'instant'});};
 function view(){return inputViewport(win.innerHeight,viewport);}
 function keyboardShown(v){return !v.zoomed&&(baseline-v.height>120||v.inset>120);}
 function release(){
  if(!mode)return;
  const anchor=visible(field)?field.getBoundingClientRect().top:null,done=afterEnd;
  win.clearTimeout(blurTimer);win.clearTimeout(endTimer);
  mode='';ending=false;afterEnd=null;hadKeyboard=false;
  body.classList.remove('editor-input-active','cart-input-active');
  for(const name of ['--input-inset','--input-top','--input-height'])root.style.removeProperty(name);
  onLayout();
  // Explicit navigation gets its own new-step scroll. Otherwise preserve the
  // field's position as the preview returns, including a manually hidden preview.
  if(done)done();else if(anchor!==null)scrollBy(field,field.getBoundingClientRect().top-anchor);
  field=null;
 }
 function ensureField(v){
  if(!visible(field)||ending||v.zoomed)return;
  const dialog=field.closest('dialog');
  const top=dialog?Math.max(v.top+12,dialog.getBoundingClientRect().top+58):v.top+12;
  const bottom=dialog?Math.min(v.top+v.height-12,dialog.getBoundingClientRect().bottom-12):v.top+v.height-footer.getBoundingClientRect().height-12;
  scrollBy(field,inputScrollDelta(field.getBoundingClientRect(),top,bottom));
 }
 function update(){
  frame=0;const ensure=ensurePending;ensurePending=false;
  if(!mode){baseline=win.innerHeight;width=win.innerWidth;return;}
  if(!layout.matches){release();return;}
  if(Math.abs(win.innerWidth-width)>60){width=win.innerWidth;baseline=win.innerHeight;hadKeyboard=false;}
  const v=view(),keyboard=keyboardShown(v);
  root.style.setProperty('--input-inset',v.inset+'px');
  root.style.setProperty('--input-top',v.top+'px');
  root.style.setProperty('--input-height',v.height+'px');
  if(!v.zoomed){
   if((ending||hadKeyboard)&&!keyboard){release();return;}
   hadKeyboard ||= keyboard;
  }
  if(ensure)ensureField(v);
 }
 function schedule(ensure=false){ensurePending ||= ensure;if(!frame)frame=win.requestAnimationFrame(update);}
 function start(element){
  if(!layout.matches||!editable(element))return;
  win.clearTimeout(blurTimer);win.clearTimeout(endTimer);ending=false;afterEnd=null;
  const anchor=element.getBoundingClientRect().top;
  if(!mode){baseline=Math.max(baseline,win.innerHeight);width=win.innerWidth;hadKeyboard=false;}
  field=element;mode=element.closest('#cart')?'cart':'editor';
  body.classList.toggle('editor-input-active',mode==='editor');
  body.classList.toggle('cart-input-active',mode==='cart');
  const v=view();root.style.setProperty('--input-height',v.height+'px');
  onLayout();scrollBy(element,element.getBoundingClientRect().top-anchor);schedule(true);
 }
 function finish(callback){
  if(!mode){callback?.();return;}
  afterEnd=callback||null;ending=true;field?.blur();
  win.clearTimeout(blurTimer);win.clearTimeout(endTimer);
  if(!keyboardShown(view())){release();return;}
  // Wait for the OS keyboard animation before restoring the preview/new step.
  // A bounded fallback also covers browsers that omit the final viewport event.
  endTimer=win.setTimeout(release,700);schedule();
 }
 doc.addEventListener('focusin',event=>start(event.target));
 doc.addEventListener('focusout',()=>{
  win.clearTimeout(blurTimer);
  blurTimer=win.setTimeout(()=>{if(mode&&!ending&&!editable(doc.activeElement))finish();},160);
 });
 doc.addEventListener('pointerdown',event=>{
  // Keep the keyboard and action position stable until the button's click fires.
  if(mode==='editor'&&event.target.closest('.control-footer button:not(:disabled)'))event.preventDefault();
  if(event.target===doc.activeElement&&editable(event.target))start(event.target);
 });
 doc.querySelector('#input-done').addEventListener('click',()=>finish());
 viewport?.addEventListener('resize',()=>schedule(true));
 viewport?.addEventListener('scroll',()=>schedule());
 win.addEventListener('resize',()=>schedule(true));
 layout.addEventListener('change',()=>schedule(true));
 new win.ResizeObserver(()=>{if(mode)schedule(true);}).observe(footer);
 return {finish};
}
