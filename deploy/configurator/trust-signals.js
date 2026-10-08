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
