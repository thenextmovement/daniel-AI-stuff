(()=>{
  const root=document.querySelector('.nt-instagram');
  if(!root)return;
  const rail=root.querySelector('.nt-instagram__rail');
  const status=root.querySelector('.nt-instagram__status');
  const bottom=root.querySelector('.nt-instagram__bottom');
  const back=root.querySelector('[data-ig-back]');
  const next=root.querySelector('[data-ig-next]');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{
    back.disabled=rail.scrollLeft<4;
    next.disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-4;
  };
  const move=direction=>rail.scrollBy({left:direction*(rail.querySelector('a')?.offsetWidth+14||rail.clientWidth*.8),behavior:reduced.matches?'instant':'smooth'});
  back.addEventListener('click',()=>move(-1));
  next.addEventListener('click',()=>move(1));
  rail.addEventListener('scroll',update,{passive:true});
  rail.addEventListener('keydown',event=>{if(event.target===rail&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}});
  const fail=()=>{root.classList.remove('is-loading');rail.hidden=true;bottom.hidden=true;status.hidden=false;status.textContent='Unsere aktuellen Projekte finden Sie auf Instagram.';};
  async function load(){
    root.classList.add('is-loading');
    status.textContent='Aktuelle Beiträge werden geladen …';
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/instagram',{signal:controller.signal});
      if(!response.ok)throw new Error('Feed unavailable');
      const data=await response.json();
      if(!data.available||data.username!=='theneontrip'||!data.posts?.length)throw new Error('Feed empty');
      for(const post of data.posts){
        if(!/^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[\w-]+\/?$/.test(post.link)||!/^\/api\/instagram\?image=[\w-]+$/.test(post.image))continue;
        const card=document.createElement('a');card.className='nt-instagram__card';card.href=post.link;card.target='_blank';card.rel='noopener noreferrer';card.setAttribute('aria-label','Instagram-Beitrag öffnen: '+post.alt);
        const image=document.createElement('img');image.alt=post.alt;image.width=640;image.height=640;image.loading='lazy';image.decoding='async';image.fetchPriority='low';
        image.sizes='(max-width: 600px) 68.4vw, (max-width: 767px) calc(30vw - 9.34px), (max-width: 900px) calc(30.54vw - 9.34px), calc(22.9vw - 10.5px)';
        image.srcset=[480,640,960].map(width=>post.image+'&w='+width+' '+width+'w').join(',');image.src=post.image+'&w=640';
        image.addEventListener('error',()=>{card.remove();if(!rail.children.length)fail();else update();},{once:true});card.append(image);
        const badge=document.createElement('span');badge.className='nt-instagram__badge';badge.setAttribute('aria-hidden','true');badge.innerHTML=post.type==='video'?'<svg viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z"/></svg>':'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg>';card.append(badge);
        if(post.date&&/^\d{4}-\d{2}-\d{2}$/.test(post.date)){const date=document.createElement('time');date.className='nt-instagram__date';date.dateTime=post.date;date.textContent=new Date(post.date+'T12:00:00Z').toLocaleDateString('de-DE',{day:'numeric',month:'short',year:'numeric'});card.append(date);}
        rail.append(card);
      }
      if(!rail.children.length)throw new Error('Feed empty');
      root.classList.remove('is-loading');rail.hidden=false;status.hidden=true;bottom.hidden=false;update();
      if('ResizeObserver'in window)new ResizeObserver(update).observe(rail);
    }catch{fail();}finally{clearTimeout(timeout);}
  }
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}},{rootMargin:'500px 0px'});observer.observe(root);}else load();
})();
