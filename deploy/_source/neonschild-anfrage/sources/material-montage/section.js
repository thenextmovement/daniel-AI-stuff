export default function init(root) {
 if (!root) return;
 const video = root.querySelector('video');
 const posterObserver = new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting) return;
  video.poster = video.dataset.poster;
  posterObserver.disconnect();
 }, { rootMargin: '600px 0px' });
 posterObserver.observe(video);
 const button = root.querySelector('.nt-material__playback');
 const progress = root.querySelector('.nt-material__progress span');
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 let visible = false;
 let manual = null;
 let request = 0;
 function paint() {
  button.setAttribute('aria-label', video.paused ? 'Montagevideo abspielen' : 'Montagevideo pausieren');
  button.classList.toggle('is-playing', !video.paused);
 }
 async function sync() {
  const token = ++request;
  if (!visible || document.hidden || manual === false || (reduced.matches && manual !== true)) {
   video.pause();
   paint();
   return;
  }
  if (!video.getAttribute('src')) { video.src = video.dataset.src; video.load(); }
  try {
   await video.play();
   // A newer pause or visibility event owns the state, even during loading.
   if (token !== request && (!visible || document.hidden || manual === false || (reduced.matches && manual !== true))) video.pause();
  } catch { /* Leave the play control available when autoplay is blocked. */ }
  paint();
 }
 button.hidden = false;
 button.addEventListener('click', () => { manual = video.paused; sync(); });
 video.addEventListener('play', paint);
 video.addEventListener('pause', paint);
 video.addEventListener('timeupdate', () => {
  progress.style.transform = `scaleX(${video.duration ? video.currentTime / video.duration : 0})`;
 });
 new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: .2 }).observe(video);
 reduced.addEventListener('change', () => { manual = null; sync(); });
 document.addEventListener('visibilitychange', sync);
 paint();
}
