import {minimumDeliveryBusinessDays,deliveryDateIsoForBusinessDays,DELIVERY_RESTRICTION_NOTE} from './delivery-calendar.js?v=20261008-min189';
let wishMinimumDays=2,refreshWishCalendar;
export function refreshWishDelivery(design){
  const minimum=minimumDeliveryBusinessDays([design]);
  if(minimum===wishMinimumDays)return;
  wishMinimumDays=minimum;refreshWishCalendar?.();
}
// Progressive enhancement only: configuration, prices and checkout remain independent.
const photos = [...document.querySelectorAll('.nt-customer-photo-link')];
if (photos.length && typeof HTMLDialogElement !== 'undefined') {
  const dialog = document.createElement('dialog');
  dialog.className = 'nt-photo-dialog';
  dialog.setAttribute('aria-label', 'Kundenfoto in voller Größe');
  dialog.innerHTML = '<img alt=""><footer><p id="nt-photo-caption" aria-live="polite"></p><nav aria-label="Kundenfotos durchblättern"><button type="button" data-prev aria-label="Vorheriges Kundenfoto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6"/></svg></button><button type="button" data-next aria-label="Nächstes Kundenfoto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></nav><button type="button" data-close-photo>Schließen</button></footer>';
  document.body.append(dialog);
  let current = 0;
  const show = index => {
    current = (index + photos.length) % photos.length;
    const link = photos[current];
    const photo = link.querySelector('img');
    dialog.querySelector('img').src = link.href;
    dialog.querySelector('img').alt = photo.alt;
    dialog.querySelector('p').textContent = `${current + 1} / ${photos.length} · ${link.closest('figure').querySelector('strong').textContent}`;
  };
  photos.forEach((link, i) => {
    link.setAttribute('aria-label', link.getAttribute('aria-label').replace(' (neuer Tab)', ''));
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); show(i); dialog.showModal();
    });
  });
  dialog.querySelector('[data-prev]').addEventListener('click', () => show(current - 1));
  dialog.querySelector('[data-next]').addEventListener('click', () => show(current + 1));
  dialog.querySelector('[data-close-photo]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
  });
}
// Product images respond to hover; the whole image remains a keyboard/touch toggle.
document.querySelectorAll('.nt-category').forEach(card => {
  const button = card.querySelector('.nt-category-toggle');
  const title = card.querySelector('h3').textContent;
  if (!button) return;
  button.hidden = false;
  const setOff = off => {
    card.classList.toggle('is-off', off);
    button.setAttribute('aria-pressed', String(off));
    button.setAttribute('aria-label', `${title}: ${off ? 'Licht einschalten' : 'Licht ausschalten'}`);
  };
  setOff(false);
  button.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') setOff(true); });
  button.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') setOff(false); });
  button.addEventListener('click', event => {
    // Hover owns mouse state; touch and keyboard can explicitly toggle it.
    if (event.pointerType === 'mouse') return;
    setOff(!card.classList.contains('is-off'));
  });
  button.addEventListener('blur', () => setOff(false));
});
// Keep all product types in one browsable row without navigating away.
const categoryRail = document.querySelector('#category-rail');
if (categoryRail) {
  const cards = [...categoryRail.querySelectorAll('.nt-category')];
  const controls = document.querySelectorAll('[data-category-step]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => {
    const edge = categoryRail.getBoundingClientRect();
    const visible = cards.map((card, index) => ({index, box: card.getBoundingClientRect()}))
      .filter(({box}) => box.left < edge.right - 8 && box.right > edge.left + 8);
    document.querySelector('#category-range').textContent = visible.length
      ? `${visible[0].index + 1}–${visible.at(-1).index + 1} von ${cards.length} Schildarten` : '';
    controls.forEach(button => {
      button.disabled = Number(button.dataset.categoryStep) < 0
        ? categoryRail.scrollLeft <= 2
        : categoryRail.scrollLeft >= categoryRail.scrollWidth - categoryRail.clientWidth - 2;
    });
  };
  const move = direction => {
    const gap = parseFloat(getComputedStyle(categoryRail).columnGap) || 0;
    const width = cards[0].getBoundingClientRect().width + gap;
    const count = Math.max(1, Math.floor((categoryRail.clientWidth + gap + 1) / width));
    categoryRail.scrollBy({left: direction * width * count, behavior: reduced.matches ? 'instant' : 'smooth'});
  };
  controls.forEach(button => button.addEventListener('click', () => move(Number(button.dataset.categoryStep))));
  categoryRail.addEventListener('keydown', event => {
    if (event.target !== categoryRail || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1);
  });
  categoryRail.addEventListener('scroll', update, {passive: true});
  new ResizeObserver(update).observe(categoryRail);
  update();
}
// Hidden chapters must not keep playing a montage video in the background.
document.querySelectorAll('.nt-material-chapters details').forEach(chapter => {
  chapter.addEventListener('toggle', () => {
    if (!chapter.open) chapter.querySelector('video')?.pause();
  });
});

// Silent demonstration: load at first sight, pause offscreen or for reduced motion.
const mountingVideo=document.querySelector('#config-mounting-video');
if(mountingVideo){
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=false,loaded=false,playRevision=0;
  mountingVideo.muted=true;
  const stop=()=>{playRevision++;mountingVideo.pause();};
  const play=()=>{
    if(document.hidden||!visible||reducedMotion.matches)return;
    if(!loaded){const source=mountingVideo.querySelector('source');source.src=source.dataset.src;source.removeAttribute('data-src');mountingVideo.load();loaded=true;}
    const revision=++playRevision;
    mountingVideo.play().then(()=>{if(revision!==playRevision&&(!visible||document.hidden||reducedMotion.matches))mountingVideo.pause();}).catch(()=>{});
  };
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){visible=entry.isIntersecting&&entry.intersectionRatio>=.1;if(visible)play();else stop();}},{threshold:[0,.1]});
    observer.observe(mountingVideo);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else play();});
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)stop();else play();});
}

// Short, one-time entrances. Content is visible even without JavaScript or observers.
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const revealItems = [...document.querySelectorAll([
  '.nt-v2-reveal', '.nt-trust-grid > a', '.nt-content-heading-row > div',
  '#config-ar .nt-ar-intro', '#config-ar .nt-ar-copy', '#config-ar .nt-ar-photo',
  '#config-product .nt-product-v2-copy', '#config-product .nt-product-v2-photo',
  '#config-product .nt-product-v2-facts > div',
  '#config-customers .nt-proof__heading', '#config-customers .nt-proof__band',
  '#config-delivery-info .nt-express__heading',
  '.nt-content-final .nt-content-inner > div', '#config-other-signs .nt-category',
  '#config-customer-photos .nt-review-wall__header', '#config-customer-photos .nt-review-wall__card'
].join(','))];
const activeEntrances = new Set();
function animateEntrance(element, {distance = 14, duration = 500, delay = 0} = {}) {
  if (motionPreference.matches || !element.animate || element.contains(document.activeElement)) return;
  const animation = element.animate([
    {opacity: 0, transform: `translateY(${distance}px)`},
    {opacity: 1, transform: 'translateY(0)'}
  ], {duration, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards'});
  activeEntrances.add(animation);
  const cleanup = () => activeEntrances.delete(animation);
  animation.addEventListener('finish', cleanup, {once: true});
  animation.addEventListener('cancel', cleanup, {once: true});
}
if ('IntersectionObserver' in window && !motionPreference.matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      // Anchor jumps/back navigation should never fade text already above the viewport.
      if (entry.boundingClientRect.top < 0) continue;
      const compact = matchMedia('(max-width: 760px)').matches;
      const delay = compact ? 0 : parseFloat(getComputedStyle(entry.target).getPropertyValue('--nt-reveal-delay')) || 0;
      animateEntrance(entry.target, {distance: compact ? 8 : 14, duration: compact ? 400 : 500, delay});
    }
  }, {threshold: .08, rootMargin: '0px 0px -24px 0px'});
  revealItems.forEach(item => observer.observe(item));
  motionPreference.addEventListener('change', event => {
    if (event.matches) {
      observer.disconnect();
    }
  });
}
motionPreference.addEventListener('change', event => {
  if (event.matches) activeEntrances.forEach(animation => animation.cancel());
});
// Keyboard focus stays fully visible, including while a section enters.
document.addEventListener('focusin', event => {
  activeEntrances.forEach(animation => {
    if (animation.effect.target.contains(event.target)) animation.cancel();
  });
});
document.querySelectorAll('#schriftzug-faq .nt-faq-list details').forEach(item => {
  item.addEventListener('toggle', () => {
    activeEntrances.forEach(animation => {
      if (item.contains(animation.effect.target)) animation.cancel();
    });
    if (item.open) item.querySelectorAll(':scope > p').forEach(answer => animateEntrance(answer, {distance: 4, duration: 180}));
  });
});

// Informational landing-page calendar and chat, specialized for the current sign.
// The delivery calendar in the cart remains authoritative; this check reserves nothing.
const wishCalendar=document.querySelector('#wish-calendar');
if(wishCalendar){
  const root=document.querySelector('#config-delivery-info'),$=selector=>root.querySelector(selector);
  const parse=value=>new Date(`${value}T12:00:00Z`),iso=date=>date.toISOString().slice(0,10);
  const today=()=>{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(parse(value).getTime())&&iso(parse(value))===value;
  // An urgent wish must be selectable here so the customer can receive useful advice.
  const selectable=value=>valid(value)&&value>=today();
  const monthName=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'});
  const dayName=new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  let month=parse(today()),selected='';month.setUTCDate(1);
  const thread=$('[data-thread]'),conversation=$('.nt-express__conversation'),form=$('.nt-express__composer'),input=form.elements.message;
  function phoneLink(){const a=document.createElement('a');a.href='tel:+4921154257240';a.textContent='0211 5425 7240 – kurz anrufen';return a;}
  function message(text,user=false,call=false){
    const row=document.createElement('div');row.className=`nt-express__message${user?' nt-express__message--user':''}`;
    const body=document.createElement('div');body.className='nt-express__message-body';
    const author=document.createElement('span');author.className='nt-express__author';author.textContent=user?'Du':'NEONTRIP · Termin-Check';
    const bubble=document.createElement('div');bubble.className='nt-express__bubble';bubble.textContent=text;
    if(call){bubble.append(document.createElement('br'),phoneLink());}
    body.append(author,bubble);row.append(body);thread.append(row);
    // Bound a purely local conversation without retaining personal data or sending requests.
    while(thread.children.length>20)thread.firstElementChild.remove();
    conversation.scrollTop=conversation.scrollHeight;
  }
  function advice(value){
    const weekend=[0,6].includes(parse(value).getUTCDay()),earliest=deliveryDateIsoForBusinessDays(wishMinimumDays);
    if(weekend)return {call:true,text:'Dein Wunschtermin liegt am Wochenende. Am besten planen wir die Ankunft vorher ein. Ruf kurz an, damit wir prüfen können, welcher Termin für dich passt.'};
    if(value<earliest)return {call:true,text:wishMinimumDays===7?'Für RGB- und Außenschilder brauchen wir mindestens 7 Werktage. Dein Termin ist dafür sehr knapp. Ruf uns kurz an – vielleicht finden wir eine passende Alternative.':'Oh, das wird etwas eng. Ruf am besten kurz an – vielleicht können wir noch etwas möglich machen.'};
    if(wishMinimumDays===2&&value===earliest)return {call:true,text:'Das sind genau 2 Werktage – grundsätzlich möglich, aber knapp. Lass uns kurz telefonisch prüfen, ob dein Entwurf noch in einen Express-Slot passt.'};
    return {call:false,text:`Ja, das sollte zeitlich passen${wishMinimumDays===7?' – auch mit der längeren Vorlaufzeit für RGB oder Außen':''}. Am besten schließt du deinen Entwurf möglichst bald ab, denn unsere Express-Slots sind begrenzt. Den verfügbaren Liefertermin wählst du im Warenkorb.`};
  }
  function reportDate(value,{user=true}={}){
    selected=value;month=parse(value);month.setUTCDate(1);render();
    if(user)message(`Ich brauche mein Schild am ${dayName.format(parse(value))}.`,true);
    const result=advice(value);message(result.text,false,result.call);
    const resultNode=$('#wish-selected');resultNode.textContent=`${dayName.format(parse(value))}: ${result.text}`;
    if(result.call)resultNode.append(phoneLink());
    $('[data-announcer]').textContent=result.text;
  }
  function render(focusDate){
    const current=parse(today()),offset=(month.getUTCDay()+6)%7,total=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
    const days=Array.from({length:offset},()=>'<span aria-hidden="true"></span>');
    for(let day=1;day<=total;day++){
      const value=iso(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),day,12)));
      days.push(`<button type="button" data-wish-date="${value}" aria-label="${dayName.format(parse(value))}" aria-pressed="${value===selected}" ${selectable(value)?'':'disabled'} ${value===today()?'aria-current="date"':''}>${day}</button>`);
    }
    wishCalendar.innerHTML=`<div class="nt-wish-month"><button type="button" data-wish-month="-1" aria-label="Vorheriger Monat" ${month.getUTCFullYear()===current.getUTCFullYear()&&month.getUTCMonth()===current.getUTCMonth()?'disabled':''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><strong>${monthName.format(month)}</strong><button type="button" data-wish-month="1" aria-label="Nächster Monat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7"/></svg></button></div><div class="nt-wish-weekdays" aria-hidden="true">${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>`<span>${d}</span>`).join('')}</div><div class="nt-wish-days" role="group" aria-label="${monthName.format(month)}">${days.join('')}</div>`;
    if(focusDate)wishCalendar.querySelector(`[data-wish-date="${focusDate}"]`)?.focus({preventScroll:true});
  }
  wishCalendar.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.wishMonth){const direction=button.dataset.wishMonth;month.setUTCMonth(month.getUTCMonth()+Number(direction));render();wishCalendar.querySelector(`[data-wish-month="${direction}"]`)?.focus({preventScroll:true});return;}
    if(selectable(button.dataset.wishDate||'')){reportDate(button.dataset.wishDate);wishCalendar.querySelector(`[data-wish-date="${selected}"]`)?.focus({preventScroll:true});}
  });
  wishCalendar.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-wish-date]'),movement={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(!button||!(event.key in movement))return;
    event.preventDefault();const date=parse(button.dataset.wishDate);date.setUTCDate(date.getUTCDate()+movement[event.key]);
    if(!selectable(iso(date)))return;month=parse(iso(date));month.setUTCDate(1);render(iso(date));
  });
  function parseText(text){
    const value=text.trim().toLocaleLowerCase('de-DE');
    const relative=value.match(/(?:^|\s)(übermorgen|uebermorgen|morgen|heute)(?=\s|[,.!?]|$)/u);
    if(relative){const date=parse(today());date.setUTCDate(date.getUTCDate()+({heute:0,morgen:1,'übermorgen':2,uebermorgen:2}[relative[1]]));return iso(date);}
    const exact=value.match(/\b\d{4}-\d{2}-\d{2}\b/);if(exact)return valid(exact[0])?exact[0]:null;
    const match=value.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/);
    if(!match)return null;const day=`${match[3]||today().slice(0,4)}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
    return valid(day)?day:null;
  }
  function submit(text){
    const value=parseText(text);
    if(value&&selectable(value)){reportDate(value);return;}
    message(text,true);
    if(value){message('Dieser Termin liegt schon in der Vergangenheit. Wähle bitte einen kommenden Tag im Kalender.');return;}
    if(/anruf|telefon|berat|mensch|persönlich/.test(text.toLocaleLowerCase('de-DE'))){message('Gerne – unser Team hilft dir persönlich mit deinem Entwurf und deinem Wunschtermin weiter.',false,true);return;}
    message('Wann brauchst du dein Schild? Wähle einen Tag im Kalender oder schreib das Datum, zum Beispiel „21.10.2026“. Für weitere Fragen erreichst du unser Team telefonisch.',false,true);
  }
  form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(!text){input.focus();return;}submit(text);input.value='';input.focus({preventScroll:true});});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
  const quick=document.createElement('div');quick.className='nt-express__quick';
  for(const [label,text] of [['Schon morgen','morgen'],['Persönlich besprechen','Ich möchte anrufen']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>submit(text));quick.append(b);}
  $('[data-widget]').append(quick);
  message('Hi! Du hast deinen Entwurf schon gestaltet. Wann soll dein Leuchtschild bei dir sein? Wähle einen Termin oder schreib mir das Datum.');
  refreshWishCalendar=()=>{
    render();if(selected){message('Dein Entwurf hat sich geändert. Ich prüfe den Termin noch einmal mit der aktuellen Ausführung.');reportDate(selected,{user:false});}
  };
  render();
  // Original landing-page proof, manually browsable without an automatic rotation.
  const scenes=[['messe.webp','Wella · Messe & Event'],['empfang.webp','ERGO · Empfang'],['store.webp','Augenblick · Schaufenster'],['aperol.webp','Aperol · Gastronomie']];let scene=0;
  root.querySelectorAll('[data-slide]').forEach(button=>button.addEventListener('click',()=>{
    scene=(scene+Number(button.dataset.slide)+scenes.length)%scenes.length;
    $('.nt-express__photo').src=`assets/content/express/${scenes[scene][0]}`;$('.nt-express__photo').alt=`NEONTRIP-Kundenprojekt: ${scenes[scene][1]}`;
    $('.nt-express__caption').textContent=scenes[scene][1];$('.nt-express__counter').textContent=`0${scene+1} / 04`;
  }));
  const reviews=[['Christoph Reichardt','Wirklich gute Qualität (v.a. für Veranstaltungen), schöner Look und unglaublich schnelle Produktions- und Versandabwicklung.'],['Dina Tarus','Besonders gefreut hat mich die schnelle Lieferung – meine Bestellung kam sogar früher als erwartet an.'],['Kerstin Kubalski','Wir sind sehr zufrieden und es ist genau so geworden, wie sich unser Sohn es erhofft hat!']];let review=0;
  root.querySelectorAll('[data-review-step]').forEach(button=>button.addEventListener('click',()=>{
    review=(review+Number(button.dataset.reviewStep)+reviews.length)%reviews.length;
    $('[data-review-name]').textContent=reviews[review][0];$('[data-review-quote]').textContent=`„${reviews[review][1]}“`;
    $('[data-review-avatar]').src=`assets/content/express/google-reviewer-${review+1}.jpg`;$('[data-review-avatar]').alt=`Profilbild von ${reviews[review][0]}`;
    $('[data-review-count]').textContent=`0${review+1} / 03`;
  }));
}
const videoRail=document.querySelector('#customer-video-rail');
if(videoRail){
  const controls=[...document.querySelectorAll('[data-video-step]')];
  const sync=()=>controls.forEach(button=>button.disabled=Number(button.dataset.videoStep)<0?videoRail.scrollLeft<=2:videoRail.scrollLeft>=videoRail.scrollWidth-videoRail.clientWidth-2);
  controls.forEach(button=>button.addEventListener('click',()=>videoRail.scrollBy({left:Number(button.dataset.videoStep)*videoRail.clientWidth*.85,behavior:motionPreference.matches?'instant':'smooth'})));
  videoRail.addEventListener('scroll',sync,{passive:true});new ResizeObserver(sync).observe(videoRail);sync();
}
// Native lazy-loading still fetches distant proof images on slow connections.
// Wait until their section approaches the viewport, including cloned video cards.
function initDeferredContentImages(){
  const images=[...document.querySelectorAll('img[data-deferred-src]')];
  const load=image=>{image.src=image.dataset.deferredSrc;delete image.dataset.deferredSrc;};
  if(!('IntersectionObserver' in window)){images.forEach(load);return;}
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){load(entry.target);observer.unobserve(entry.target);}
  },{rootMargin:'300px 0px'});
  images.forEach(image=>observer.observe(image));
}
if(document.readyState==='complete')initDeferredContentImages();
else addEventListener('DOMContentLoaded',initDeferredContentImages,{once:true});
