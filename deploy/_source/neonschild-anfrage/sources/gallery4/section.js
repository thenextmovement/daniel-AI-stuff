(() => {
const galleryPhotos = __GALLERY4_PHOTOS__;
const galleryStyles = __GALLERY4_STYLES__;
/* NEONTRIP gallery study. Independent CSS/DOM implementation inspired by
 * Crafter UI Works Wheel, cult/ui 3D Carousel, Kedhareswer Polaroid Line, Daniel Petho Parallax Floating, and Shadcnblocks Gallery4. No runtime dependencies. */
class NeontripGallery extends HTMLElement {
 static get observedAttributes(){return ['variant']}
 constructor(){super();this.attachShadow({mode:'open'});this.selected=0;this.opened=false;this.spin=0;this.rotation=0;this.frame=0;this.reduce=matchMedia('(prefers-reduced-motion: reduce)');this.abort=new AbortController();}
 connectedCallback(){
  this.photos=galleryPhotos;
  const arrow=(dir)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${dir==='left'?'M19 12H5m6-6-6 6 6 6':'M5 12h14m-6-6 6 6-6 6'}"/></svg>`;
  const expand='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/></svg>';
  this.shadowRoot.innerHTML=`<style>${galleryStyles}</style><section class="gallery" aria-label="NEONTRIP Projektgalerie">
  <div class="intro"><div><p class="eyebrow">Echte Projekte. Echtes Licht.</p><h2>So sieht Wirkung aus.</h2></div><p class="intro-copy">Ihr Design als LED-Neonschild – für Empfang, Ladenlokal oder Event. Mit kostenloser 3D-Vorschau und unverbindlichem Angebot.</p><div class="gallery4-nav"><button class="cards-prev round" aria-label="Vorherige Fotokarte">${arrow('left')}</button><button class="cards-next round" aria-label="Nächste Fotokarte">${arrow('right')}</button></div></div>
  <div class="composition"><div class="stage" tabindex="0" role="region" aria-roledescription="Karussell" aria-label="Projektbilder" aria-description="Mit Mausrad, Trackpad oder Pfeiltasten durch die Projekte blättern."><svg class="hanging-line" aria-hidden="true" fill="none"><path/></svg><div class="space"><div class="ring">${this.photos.map((p,i)=>`<button class="photo" data-photo="${i}"><img data-src="${p.thumb}" loading="lazy" decoding="async" fetchpriority="low" alt="${p.alt}" draggable="false" style="object-position:${p.position};--gallery4-position:${p.gallery4Position||p.position};--gallery4-fit:${p.gallery4Fit||'cover'}" width="720" height="720"><span class="print-caption"><span>${p.title}</span><span class="print-number">${String(i+1).padStart(2,'0')}</span></span><span class="card-copy"><span class="card-category">${p.category}</span><strong>${p.title}</strong><span class="card-description">${p.alt}</span><span class="card-link">Foto ansehen ${arrow('right')}</span></span><span class="photo-action">${expand}</span></button>`).join('')}</div></div><div class="center-title"><span>NEONTRIP</span><strong>Ideen werden<br>zu Licht.</strong><button class="explore">Projekte entdecken ${arrow('right')}</button></div><span class="stage-number" aria-hidden="true">01 — 08</span></div>
  <aside class="index" aria-label="Projekt direkt auswählen"><p class="index-label">Ausgewählte Projekte <span>08</span></p>${this.photos.map((p,i)=>`<button data-index="${i}"><span class="index-no">${String(i+1).padStart(2,'0')}</span><span>${p.title}</span><span class="index-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button>`).join('')}</aside></div>
  <div class="card-dots" role="group" aria-label="Fotokarte auswählen">${this.photos.map((p,i)=>`<button data-dot="${i}" aria-label="Motiv ${i+1}: ${p.title}" aria-current="${i===0?'true':'false'}"><span></span></button>`).join('')}</div>
  <div class="bottom"><div class="project-caption" aria-live="polite"><span class="count">01 / 08</span><div><p class="project-name">Acht Projekte. Viele Perspektiven.</p><p class="project-category">Wählen Sie ein Motiv aus dem Bildring.</p></div></div><div class="controls"><button class="overview" aria-label="Zurück zum Bildring">Übersicht</button><button class="previous round" aria-label="Vorheriges Projekt">${arrow('left')}</button><button class="next round" aria-label="Nächstes Projekt">${arrow('right')}</button><button class="enlarge" aria-label="Aktuelles Bild vergrößern">Bild ansehen ${expand}</button></div></div>
  <p class="help" id="help"><span>Ziehen oder Projekt wählen</span><span class="key-hint">Pfeiltasten zum Entdecken</span></p>
  <dialog aria-label="Projektfoto in Großansicht" aria-describedby="project-description"><div class="dialog-top"><p class="dialog-title"></p><button class="close round" aria-label="Großansicht schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><img class="dialog-image" alt=""><p class="dialog-description" id="project-description"></p><div class="dialog-bottom"><button class="dialog-prev round" aria-label="Vorheriges Bild">${arrow('left')}</button><span class="dialog-counter"></span><button class="dialog-next round" aria-label="Nächstes Bild">${arrow('right')}</button></div></dialog>
  </section>`;
  this.$=s=>this.shadowRoot.querySelector(s);this.stage=this.$('.stage');this.cards=[...this.shadowRoot.querySelectorAll('.photo')];this.list=[...this.shadowRoot.querySelectorAll('[data-index]')];
  const on=(el,event,fn,options={})=>el.addEventListener(event,fn,{signal:this.abort.signal,...options});
  this.cards.forEach((b,i)=>on(b,'click',()=>{if(this.dragged)return;if(['floating','gallery4'].includes(this.mode)){this.select(i);this.showPhoto();return}if(this.opened&&i===this.selected)this.showPhoto();else this.select(i)}));
  this.list.forEach((b,i)=>on(b,'click',()=>this.select(i)));
  this.dots=[...this.shadowRoot.querySelectorAll('[data-dot]')];this.dots.forEach((b,i)=>on(b,'click',()=>this.select(i)));on(this.$('.cards-prev'),'click',()=>this.step(-1));on(this.$('.cards-next'),'click',()=>this.step(1));
  on(this.$('.explore'),'click',()=>{this.select(0);if(this.mode==='floating')this.showPhoto()});on(this.$('.previous'),'click',()=>this.step(-1));on(this.$('.next'),'click',()=>this.step(1));on(this.$('.overview'),'click',()=>this.overview());on(this.$('.enlarge'),'click',()=>this.showPhoto());
  on(this.$('.close'),'click',()=>this.$('dialog').close());on(this.$('.dialog-prev'),'click',()=>{this.step(-1);this.updateDialog()});on(this.$('.dialog-next'),'click',()=>{this.step(1);this.updateDialog()});
  on(this.$('dialog'),'click',e=>{if(e.target===this.$('dialog'))this.$('dialog').close()});
  on(this.$('dialog'),'keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.step(e.key==='ArrowLeft'?-1:1);this.updateDialog()}});
  on(this.stage,'keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape','Enter',' '].includes(e.key)){if(e.target.tagName==='BUTTON'&&['Enter',' '].includes(e.key))return;e.preventDefault();if(e.key==='Home')this.mode==='wheel'?this.overview():this.select(0);else if(e.key==='End')this.select(7);else if(e.key==='Escape')this.overview();else if(e.key==='Enter'||e.key===' ')this.opened?this.showPhoto():this.select(0);else this.step(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)}});
  on(this.stage,'pointerdown',e=>{if(e.button!==0)return;if(this.mode==='floating'){this.floatTouch=e.pointerType==='touch'?{x:e.clientX,y:e.clientY}:null;this.dragged=false;this.moveFloating(e);return}this.start={x:e.clientX,y:e.clientY,spin:this.spin,rotation:this.rotation};this.dragged=false;this.stage.classList.add('dragging')});
  on(this.stage,'pointermove',e=>{if(this.mode==='floating'){if(this.floatTouch&&Math.hypot(e.clientX-this.floatTouch.x,e.clientY-this.floatTouch.y)>8)this.dragged=true;this.moveFloating(e);return}if(!this.start)return;const horizontal=this.mode!=='wheel'||this.stage.clientWidth<600;const delta=horizontal?e.clientX-this.start.x:e.clientY-this.start.y;if(Math.abs(delta)>8){this.dragged=true;this.stage.setPointerCapture(e.pointerId)}if(!this.dragged)return;if(this.mode==='carousel'){this.rotation=this.start.rotation+delta*.16;this.spin=-this.rotation/45;this.opened=true;this.draw()}else if(this.mode==='gallery4'){this.scrollCards(this.start.spin*this.cardSpacing-delta,false)}else if(this.mode==='polaroid'){this.spin=this.start.spin-delta/this.printSpacing;this.draw(false)}else{this.opened=true;this.select(Math.max(0,Math.min(7,Math.round(this.start.spin-delta/150))),false)}});
  const stop=()=>{if(this.mode==='floating'){if(this.floatTouch){this.floatPoint={x:0,y:0};this.draw()}this.floatTouch=null;setTimeout(()=>this.dragged=false,0);return}if(!this.start)return;this.start=null;this.stage.classList.remove('dragging');if(this.dragged){if(this.mode==='gallery4')this.scrollCards(this.spin*this.cardSpacing);else this.select(((Math.round(this.spin)%8)+8)%8);setTimeout(()=>this.dragged=false,0)}};
  on(this.stage,'pointerup',stop);on(this.stage,'pointercancel',stop);on(this.stage,'lostpointercapture',e=>{if(e.target===this.stage)stop()});
  on(this.stage,'pointerleave',()=>{if(this.mode==='floating'){this.floatPoint={x:0,y:0};this.draw()}});
  let wheelTimer;on(this.stage,'wheel',e=>{if(this.mode==='floating'||e.ctrlKey)return;
   if(this.mode==='gallery4'){
    const unit=e.deltaMode===1?16:e.deltaMode===2?this.stage.clientWidth:1;
    const delta=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*unit;
    const current=Math.min(this.spin*this.cardSpacing,this.maxOffset);
    const next=Math.max(0,Math.min(this.maxOffset,current+delta));
    // At either end the same wheel gesture continues scrolling the page.
    if(Math.abs(next-current)<.5)return;
    e.preventDefault();this.scrollCards(next,false);return;
   }
   if(!this.stage.matches(':focus-within'))return;const d=e.deltaY||e.deltaX;if(Math.abs(d)<4)return;if(this.mode==='wheel'&&((this.selected===7&&d>0)||(!this.opened&&d<0)))return;e.preventDefault();clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>this.step(d>0?1:-1),80)},{passive:false});
  this.observer=new ResizeObserver(()=>{this.draw();this.update()});this.observer.observe(this.stage);on(this.reduce,'change',()=>{if(this.reduce.matches)this.cards.forEach(c=>c.getAnimations().filter(a=>a.id==='polaroid-swing').forEach(a=>a.cancel()));this.draw()});this.setMode();
  // Warm visible cards and the next card before the gallery enters the viewport.
  // Native lazy loading also fetches transformed cards far outside this carousel.
  this.photoObserver=new IntersectionObserver(entries=>{this.photosNear=entries[0].isIntersecting;if(this.photosNear)this.loadVisiblePhotos()},{rootMargin:'200px 0px'});
  this.photoObserver.observe(this.stage);
 }
 disconnectedCallback(){this.abort.abort();this.observer?.disconnect();this.photoObserver?.disconnect();cancelAnimationFrame(this.frame)}
 attributeChangedCallback(){if(this.stage)this.setMode()}
 setMode(){this.mode=['carousel','polaroid','floating','gallery4'].includes(this.getAttribute('variant'))?this.getAttribute('variant'):'wheel';cancelAnimationFrame(this.frame);this.frame=0;this.floatPoint={x:0,y:0};this.start=null;this.floatTouch=null;this.cards.forEach(c=>c.getAnimations().forEach(a=>a.cancel()));this.stage.setAttribute('aria-roledescription',this.mode==='floating'?'Galerie':'Karussell');this.$('.explore').firstChild.textContent=this.mode==='floating'?'Alle Motive ansehen ':'Projekte entdecken ';this.$('.gallery').dataset.variant=this.mode;this.opened=this.mode!=='wheel';this.selected=0;this.spin=0;this.rotation=0;this.update();this.draw()}
 select(i,animate=true){const previous=this.spin;this.selected=this.mode==='gallery4'?Math.max(0,Math.min(7,i)):(i+8)%8;this.opened=true;this.spin=this.mode==='gallery4'?Math.min(this.selected,this.maxOffset/this.cardSpacing):this.selected;if(this.mode==='carousel'){let diff=-this.selected*45-this.rotation;diff=((diff+180)%360+360)%360-180;this.rotation+=diff}this.update();this.draw(animate);if(this.mode==='polaroid'&&animate&&!this.reduce.matches){const direction=Math.sign(this.spin-previous)||1;this.cards.forEach((c,n)=>{c.getAnimations().filter(a=>a.id==='polaroid-swing').forEach(a=>a.cancel());const swing=c.animate([{rotate:`${direction*-6}deg`},{rotate:`${direction*3}deg`,offset:.42},{rotate:`${direction*-1.3}deg`,offset:.7},{rotate:'0deg'}],{duration:1250+n%3*55,easing:'ease-out'});swing.id='polaroid-swing'})}}
 // Card navigation follows the visible offset; the lightbox follows the chosen photo.
 scrollCards(position,animate=true){const offset=Math.max(0,Math.min(this.maxOffset,position));this.spin=offset/this.cardSpacing;this.selected=offset>=this.maxOffset-.5?this.photos.length-1:Math.min(this.photos.length-1,Math.round(this.spin));this.draw(animate);this.update()}
 step(delta){if(!this.opened){this.select(0);return}if(this.mode==='gallery4'&&!this.$('dialog').open){this.scrollCards((this.spin+delta)*this.cardSpacing);return}this.select(this.$('dialog').open?(this.selected+delta+8)%8:this.selected+delta)}
 overview(){if(this.mode!=='wheel')return;this.opened=false;this.selected=0;this.spin=0;this.update();this.draw()}
 update(){const p=this.photos[this.selected];this.$('.gallery').classList.toggle('is-open',this.opened);this.$('.project-name').textContent=this.opened?p.title:'Acht Projekte. Viele Perspektiven.';this.$('.project-category').textContent=this.opened?p.category:'Wählen Sie ein Motiv aus dem Bildring.';this.$('.count').textContent=this.opened?`${String(this.selected+1).padStart(2,'0')} / 08`:'01 — 08';this.$('.stage-number').textContent=this.opened?`${String(this.selected+1).padStart(2,'0')} — 08`:'01 — 08';this.$('.overview').hidden=!this.opened||this.mode!=='wheel';this.$('.enlarge').hidden=!this.opened;this.$('.help span').textContent=this.mode!=='wheel'?'Seitlich ziehen · Bild anklicken zum Vergrößern':'Ziehen oder Projekt wählen';this.list.forEach((b,i)=>b.setAttribute('aria-current',String(this.opened&&i===this.selected)));this.cards.forEach((b,i)=>{if(this.mode==='gallery4')b.removeAttribute('aria-label');else b.setAttribute('aria-label',this.photos[i].title+(['floating','gallery4'].includes(this.mode)||this.opened&&i===this.selected?' vergrößern':' auswählen'));b.tabIndex=this.mode==='floating'?0:this.opened?(i===this.selected?0:-1):0});if(this.mode==='floating'){this.$('.project-name').textContent='Acht Projekte. Viele Perspektiven.';this.$('.project-category').textContent='Ein Motiv anklicken und das ganze Projektfoto ansehen.';this.$('.count').textContent='01 — 08';this.$('.help span').textContent='Maus oder Finger bewegen · Fotos entdecken';this.$('.key-hint').textContent='Mit Tab ein Bild wählen, mit Enter öffnen'}else this.$('.key-hint').textContent='Pfeiltasten zum Entdecken';this.dots.forEach((b,i)=>b.setAttribute('aria-current',String(i===this.selected)));const position=this.spin*this.cardSpacing;this.$('.cards-prev').disabled=this.mode==='gallery4'?position<.5:this.selected===0;this.$('.cards-next').disabled=this.mode==='gallery4'?position>=this.maxOffset-.5:this.selected===7;}
 draw(animate=true){
  if(!this.stage)return;const w=this.stage.clientWidth,h=this.stage.clientHeight,mobile=w<600;this.stage.classList.toggle('instant',this.reduce.matches||!animate);const N=this.photos.length;
  if(this.mode==='wheel'){
   this.$('.space').style.perspective='1050px';this.$('.ring').style.transform='none';
   const radius=Math.min(w*.30,h*.35),rw=radius*.83,rh=rw*.69;const fw=Math.min(w*.76,560),fh=Math.min(h*.72,405);
   this.cards.forEach((card,i)=>{const angle=i*2*Math.PI/N;let x,y,z,rz,rx,scale,opacity;
    if(!this.opened){x=Math.sin(angle)*radius;y=-Math.cos(angle)*radius;z=0;rz=i*360/N;rx=0;scale=1;opacity=1;card.style.width=rw+'px';card.style.height=rh+'px'}
    else{const d=i-this.selected;x=-Math.abs(d)*fw*.20;y=d*(fh*.84+35);z=-Math.abs(d)*190;rz=0;rx=d*-48;scale=1;opacity=Math.abs(d)<2?1:0;const fitW=Math.min(fw,fh*this.photos[i].ratio);card.style.width=fitW+'px';card.style.height=(fitW/this.photos[i].ratio)+'px'}
    card.style.transform=`translate3d(${x}px,${y}px,${z}px) rotateZ(${rz}deg) rotateX(${rx}deg) scale(${scale})`;card.style.opacity=opacity;card.style.pointerEvents=opacity?'auto':'none';card.style.visibility=opacity?'visible':'hidden';card.style.zIndex=String(50-Math.abs(i-this.selected));
   });
  }else if(this.mode==='gallery4'){
   const compact=matchMedia('(max-width:700px)').matches,cw=compact?w*.84:Math.min(370,w*.42),gap=compact?16:24,ch=cw/1.12+110;this.stage.style.setProperty('--gallery4-height',ch+'px');this.cardSpacing=cw+gap;
   this.maxOffset=Math.max(0,N*this.cardSpacing-gap-w);const offset=Math.max(0,Math.min(this.spin*this.cardSpacing,this.maxOffset));this.spin=offset/this.cardSpacing;
   this.$('.space').style.perspective='none';this.$('.ring').style.transform='none';
   this.cards.forEach((card,i)=>{card.style.width=cw+'px';card.style.height=ch+'px';card.style.transform=`translate3d(${i*this.cardSpacing-offset}px,0,0)`;card.style.opacity='1';card.style.visibility='visible';card.style.pointerEvents='auto';card.style.zIndex='1';});
  }else if(this.mode==='floating'){
   const points=mobile?[
    [.14,.12,.23,.19,1.0],[.42,.09,.20,.14,.45],[.77,.13,.32,.15,1.4],[.89,.40,.18,.18,.8],
    [.13,.43,.23,.145,.7],[.22,.72,.28,.22,1.5],[.62,.70,.38,.18,.5],[.80,.90,.24,.18,1.15]
   ]:[
    [.14,.26,.155,.41,1],[.38,.15,.09,.245,.45],[.62,.16,.205,.255,1.4],[.87,.23,.145,.335,.8],
    [.13,.69,.20,.27,.7],[.35,.80,.13,.30,1.5],[.64,.83,.19,.245,.5],[.90,.76,.12,.365,1.15]
   ];
   const point=this.reduce.matches?{x:0,y:0}:(this.floatPoint||{x:0,y:0}),travel=mobile?13:30;
   this.$('.space').style.perspective='none';this.$('.ring').style.transform='none';
   this.cards.forEach((card,i)=>{const [px,py,pw,ph,depth]=points[i];card.style.width=(w*pw)+'px';card.style.height=(h*ph)+'px';card.style.transform=`translate3d(${(px-.5)*w-point.x*travel*depth}px,${(py-.5)*h-point.y*travel*depth}px,0)`;card.style.opacity='1';card.style.visibility='visible';card.style.pointerEvents='auto';card.style.zIndex=String(Math.round(depth*10));});
  }else if(this.mode==='polaroid'){
   const cw=mobile?Math.min(w*.68,270):Math.min(w*.25,310),ch=cw*1.13,spacing=cw+(mobile?26:48);this.printSpacing=spacing;
   const sag=mobile?28:54,y0=Math.max(30,(h-ch-sag)*.38);
   this.$('.space').style.perspective='none';this.$('.ring').style.transform='none';
   this.$('.hanging-line').setAttribute('viewBox',`0 0 ${w} ${h}`);this.$('.hanging-line path').setAttribute('d',`M 0 ${y0} Q ${w/2} ${y0+sag*2} ${w} ${y0}`);
   this.cards.forEach((card,i)=>{
    const d=((i-this.spin+N*1.5)%N)-N*.5,x=d*spacing,t=Math.max(0,Math.min(1,(w/2+x)/w)),y=y0+4*sag*t*(1-t)+6;
    const tilt=this.reduce.matches?0:Math.max(-5,Math.min(5,d*2.6))+(i%2?.7:-.7);
    card.style.width=cw+'px';card.style.height=ch+'px';card.style.transform=`translate3d(${x}px,${y}px,0) rotateZ(${tilt}deg)`;card.style.opacity='1';card.style.pointerEvents=Math.abs(d)<2.5?'auto':'none';card.style.visibility=Math.abs(d)<3?'visible':'hidden';card.style.zIndex=String(50-Math.round(Math.abs(d)*5));
   });
  }else{
   const cw=mobile?Math.min(w*.60,270):Math.min(w*.235,310),ch=mobile?Math.min(h*.77,325):Math.min(h*.81,370),radius=mobile?cw*1.38:cw*1.42;
   this.$('.space').style.perspective=(mobile?850:1500)+'px';this.$('.ring').style.transform=`translateZ(${-radius}px) rotateY(${this.rotation}deg)`;
   this.cards.forEach((card,i)=>{const a=i*360/N;const facing=Math.cos((a+this.rotation)*Math.PI/180);card.style.width=cw+'px';card.style.height=ch+'px';card.style.transform=`rotateY(${a}deg) translateZ(${radius}px)`;card.style.opacity=facing>-.14?String(.45+Math.max(0,facing)*.55):'0';card.style.pointerEvents=facing>0?'auto':'none';card.style.visibility='visible';card.style.zIndex=String(Math.round(facing*100));});
  }
  this.loadVisiblePhotos();
 }
 loadVisiblePhotos(){
  if(!this.photosNear)return;
  const offset=this.spin*this.cardSpacing;
  this.cards.forEach((card,i)=>{
   if(this.mode==='gallery4'&&(i*this.cardSpacing-offset>this.stage.clientWidth+this.cardSpacing||(i+1)*this.cardSpacing-offset<-this.cardSpacing))return;
   const img=card.querySelector('img[data-src]');
   if(img){img.src=img.dataset.src;delete img.dataset.src;img.loading='eager'}
  });
 }
 moveFloating(event){
  if(this.reduce.matches)return;const b=this.stage.getBoundingClientRect();this.floatPoint={x:Math.max(-1,Math.min(1,(event.clientX-b.left)/b.width*2-1)),y:Math.max(-1,Math.min(1,(event.clientY-b.top)/b.height*2-1))};cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{this.frame=0;if(this.mode==='floating')this.draw()});
 }
 showPhoto(){if(!this.opened)this.select(0);this.updateDialog();this.$('dialog').showModal()}
 updateDialog(){const p=this.photos[this.selected];this.$('.dialog-image').src=p.image;this.$('.dialog-image').alt=p.alt;this.$('.dialog-title').textContent=p.title+' / '+p.category;this.$('.dialog-description').textContent=p.description||'';this.$('.dialog-counter').textContent=`${String(this.selected+1).padStart(2,'0')} / 08`}
}
customElements.define('neontrip-gallery',NeontripGallery);

})();
