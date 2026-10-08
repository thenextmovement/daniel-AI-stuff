// Entry assistance is deliberately separate from product/draft data.
export function createDraftWriteGuard(){
  let blocked=false;
  return {block(){blocked=true;},release(){blocked=false;},get blocked(){return blocked;},write(save,snapshot){if(blocked)return false;save(snapshot);return true;}};
}
export function initEntryOnboarding({field,help,label,storage=()=>localStorage}){
  const key='neontrip-entry-help-dismissed-v1';
  let eligible=false,dismissed=false;
  try{dismissed=storage().getItem(key)==='1';}catch{}
  const hide=(remember=false)=>{help.hidden=true;if(remember){dismissed=true;try{storage().setItem(key,'1');}catch{}}};
  const select=()=>{if(!eligible)return;eligible=false;field.focus({preventScroll:true});field.select();};
  // Consume the first deliberate pointer entry before the browser places a caret.
  field.addEventListener('pointerdown',event=>{if(eligible&&event.button===0){event.preventDefault();select();}});
  field.addEventListener('focus',select);
  field.addEventListener('input',()=>{eligible=false;hide(true);});
  help.querySelector('[data-entry-start]').addEventListener('click',()=>{select();field.focus({preventScroll:true});});
  help.querySelector('[data-entry-close]').addEventListener('click',()=>{
    const hadFocus=help.contains(document.activeElement);hide(true);
    if(hadFocus){label.tabIndex=-1;label.focus({preventScroll:true});}
  });
  return {start(fresh){eligible=!!fresh;help.hidden=!fresh||dismissed;},end(){eligible=false;hide();}};
}
