export default function init(root){
 if(!root||root.dataset.motionInitialized)return;
 root.dataset.motionInitialized='true';
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 const steps=[...root.querySelectorAll('.nt-steps__step')];
 if(motion.matches||!('IntersectionObserver' in window))return;
 root.dataset.motionReady='true';
 const desktop=matchMedia('(min-width:1101px)');
 const tablet=matchMedia('(min-width:621px)');
 steps.forEach((step,index)=>step.style.setProperty('--nt-trace-delay',`${desktop.matches?index*.42:tablet.matches?(index%2)*.14:0}s`));
 const observer=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
   if(!entry.isIntersecting||entry.intersectionRatio<.55)return;
   entry.target.classList.add('is-traced');
   observer.unobserve(entry.target);
  });
 },{threshold:.55,rootMargin:'0px 0px -80px 0px'});
 steps.forEach(step=>observer.observe(step));
 const finish=()=>{
  if(!motion.matches)return;
  observer.disconnect();
  delete root.dataset.motionReady;
  steps.forEach(step=>step.classList.add('is-traced'));
  motion.removeEventListener('change',finish);
 };
 motion.addEventListener('change',finish);
}
