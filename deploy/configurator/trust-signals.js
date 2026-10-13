// Reuse the existing review wall as the single source for score, count and link.
// No external widget, tracking call or change to purchase state.
(() => {
 const source=document.querySelector('.nt-review-wall__summary');
 const score=source?.querySelector('.nt-review-wall__score strong')?.textContent.trim();
 const count=source?.querySelector('.nt-review-wall__total')?.textContent.match(/^\s*(\d+)\s+Rezensionen\s*$/)?.[1];
 if(!/^\d,\d$/.test(score||'')||!count||!source.href)return;
 for(const link of document.querySelectorAll('[data-trust-rating]')){
  link.href=source.href;link.target='_blank';link.rel='noopener noreferrer';
  link.setAttribute('aria-label',source.getAttribute('aria-label'));
  link.querySelector('[data-trust-rating-copy]').textContent=`${score}${link.dataset.trustRating==='compact'?'':'/5'} · ${count} Bewertungen`;
  link.hidden=false;
 }
})();

// Customer photos must not compete with the first usable sign preview.
(() => {
 const region=document.querySelector('.preview-column');
 const images=[...document.querySelectorAll('img[data-proof-src]')];
 if(!region||!images.length)return;
 const load=image=>{image.src=image.dataset.proofSrc;delete image.dataset.proofSrc;};
 function ready(){
  if(!('IntersectionObserver' in window)){images.forEach(load);return;}
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting){load(entry.target);observer.unobserve(entry.target);}
  },{rootMargin:'100px 0px'});
  images.forEach(image=>observer.observe(image));
 }
 if(!region.inert){ready();return;}
 const startup=new MutationObserver(()=>{if(!region.inert){startup.disconnect();ready();}});
 startup.observe(region,{attributes:true,attributeFilter:['inert']});
})();
