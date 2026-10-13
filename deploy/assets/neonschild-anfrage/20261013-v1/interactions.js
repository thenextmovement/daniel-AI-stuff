// Local preview wiring only. The LED form initializes in sources/inquiry-b.
// Native mobile lazy loading can fetch several screens ahead. Reserve image
// dimensions in HTML and load these section photographs just before approach.
(() => {
 const load = image => {
  if (image.dataset.nearSrcset) image.srcset = image.dataset.nearSrcset;
  image.src = image.dataset.nearSrc;
  image.loading = 'eager';
  delete image.dataset.nearSrc;
  delete image.dataset.nearSrcset;
 };
 const images = document.querySelectorAll('img[data-near-src]');
 if (!('IntersectionObserver' in window)) { images.forEach(load); return; }
 const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
   if (!entry.isIntersecting) return;
   observer.unobserve(entry.target);
   load(entry.target);
  });
 }, {rootMargin:'600px 0px'});
 images.forEach(image => observer.observe(image));
})();

// Keep the live product gallery, adding keyboard focus and an Escape exit.
const originalOpen=window.openProductGallery,originalClose=window.closeProductGallery;
const modal=document.querySelector('#product-gallery-modal');
const panel=modal.querySelector('.pgm-panel');
panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
panel.setAttribute('aria-labelledby','pgm-title');panel.tabIndex=-1;
const closeButton=panel.querySelector('button');closeButton.setAttribute('aria-label','Produktgalerie schließen');
let previousFocus;
window.openProductGallery=function(key){previousFocus=document.activeElement;originalOpen(key);panel.focus()};
window.closeProductGallery=function(){originalClose();previousFocus?.focus({preventScroll:true})};
modal.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();window.closeProductGallery()}
  if(event.key==='Tab'){
    const buttons=[...panel.querySelectorAll('button,a[href]')],first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
});


// One quiet entrance for photographs; copy never waits for an animation.
(() => {
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 if (reduced.matches || !('IntersectionObserver' in window)) return;
 const running = new Set();
 const targets = [...document.querySelectorAll('.nt-steps__photo > img, .nt-steps__photo > svg, .nt-proof__videos, .nt-material__film')];
 const reveal = (entries, observer) => {
  entries.forEach(entry => {
   if (!entry.isIntersecting || (entry.target.closest('.nt-steps__photo') && entry.intersectionRatio < .65)) return;
   observer.unobserve(entry.target);
   if (reduced.matches || entry.target.contains(document.activeElement)) return;
   const photo = entry.target.closest('.nt-steps__photo');
   const index = photo ? [...document.querySelectorAll('.nt-steps__photo')].indexOf(photo) : 0;
   const animation = entry.target.animate([
    { opacity: .65, transform: photo ? 'translateY(12px) scale(1.045)' : 'translateY(20px)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' }
   ], { duration: 850, delay: innerWidth > 1100 ? index * 90 : 0, easing: 'cubic-bezier(.22,1,.36,1)' });
   running.add(animation);
   animation.finished.then(() => running.delete(animation), () => running.delete(animation));
  });
 };
 const observer = new IntersectionObserver(reveal, { threshold: .12, rootMargin: '0px 0px -36px 0px' });
 const processObserver = new IntersectionObserver(reveal, { threshold: .65, rootMargin: '0px 0px -80px 0px' });
 targets.forEach(target => (target.closest('.nt-steps__photo') ? processObserver : observer).observe(target));
 const bolt = document.querySelector('.nt-steps__brand-layer');
 const heading = document.querySelector('.nt-steps__header');
 // The decorative bolt protrudes into the previous section; it cannot be the trigger.
 const boltObserver = new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting || entries[0].intersectionRatio < .85) return;
  bolt.classList.add('is-illuminated');
  boltObserver.disconnect();
 }, { threshold: .85, rootMargin: '0px 0px -80px 0px' });
 if (bolt && heading) boltObserver.observe(heading);
 reduced.addEventListener('change', () => {
  if (!reduced.matches) return;
  observer.disconnect();
  processObserver.disconnect();
  boltObserver.disconnect();
  running.forEach(animation => animation.cancel());
 });
})();
