#!/usr/bin/env node
/**
 * Injects 3-step multi-step form into hero section of all LPs (mobile).
 * Step 1: Produktart, Innen/Außen, Größe
 * Step 2: Logo/Design Upload (optional)
 * Step 3: Name, E-Mail, Firma, Telefon
 */
const fs = require('fs');

function formDE(slug, defaultProduct) {
  return `<div class="w-full max-w-[380px] mx-auto"><form action="/api/c" method="POST" enctype="multipart/form-data" id="hero-form" class="bg-white rounded-[16px] p-4 border border-black/5 shadow-[0_8px_40px_rgba(0,0,0,0.08)]" style="backdrop-filter:blur(20px);">
<input type="hidden" name="source" value="hero-form-${slug}">
<div class="nt-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
<div class="text-center mb-3" id="hero-form-header">
<h2 class="text-[17px] font-semibold text-dark tracking-[-0.03em] leading-tight">Angebot in 1 Minute</h2>
<p class="text-[11px] font-medium text-dark/40 mt-0.5">Design hochladen und Angebot erhalten</p>
</div>
<div class="flex items-center gap-1.5 mb-3">
<div class="flex-1 h-[3px] rounded-full bg-accent" id="hero-bar-1"></div>
<div class="flex-1 h-[3px] rounded-full bg-dark/[0.08]" id="hero-bar-2"></div>
<div class="flex-1 h-[3px] rounded-full bg-dark/[0.08]" id="hero-bar-3"></div>
</div>
<div id="hero-step-1" class="hf-step">
<p class="text-[11px] font-semibold text-dark/50 uppercase tracking-wider mb-2">Schritt 1 von 3 — Projekt</p>
<div class="space-y-3 mb-3">
<div><label class="text-[12px] font-semibold text-dark block mb-1">Produktart</label>
<select name="produkt" id="hero-produkt" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark appearance-none cursor-pointer" style="background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%230A0A0A%22 stroke-width=%221.5%22 viewBox=%220 0 24 24%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 12px center;background-size:14px;">
<option value="${defaultProduct}" selected>${defaultProduct}</option>
<option value="LED Neonschild">LED Neonschild</option>
<option value="3D Buchstaben (Front)">3D Buchstaben (Front)</option>
<option value="3D Buchstaben (Rückbeleuchtet)">3D Buchstaben (Rückbeleuchtet)</option>
<option value="Leuchtkasten">Leuchtkasten</option>
<option value="Marquee-Buchstaben">Marquee-Buchstaben</option>
<option value="Vollflächig beleuchtet">Vollflächig beleuchtet</option>
<option value="Unbeleuchtet">Unbeleuchtet</option>
</select></div>
<div><label class="text-[12px] font-semibold text-dark block mb-1">Einsatzort</label>
<div class="grid grid-cols-2 gap-2">
<label class="flex items-center gap-2 bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent/5"><input type="radio" name="einsatzort" value="Innen" checked class="accent-accent w-4 h-4"><span class="text-[13px] font-medium text-dark">Innen</span></label>
<label class="flex items-center gap-2 bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent/5"><input type="radio" name="einsatzort" value="Außen" class="accent-accent w-4 h-4"><span class="text-[13px] font-medium text-dark">Außen</span></label>
</div></div>
<div><label class="text-[12px] font-semibold text-dark block mb-1">Gewünschte Größe</label>
<input type="text" name="groesse" placeholder="z.B. 100 cm Breite" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
</div>
<button type="button" id="hero-next-1" class="w-full bg-accent text-white font-semibold text-[13px] py-3 rounded-xl hover:bg-accent/90 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(250,49,162,0.25)]">Weiter <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
</div>
<div id="hero-step-2" class="hf-step hidden">
<p class="text-[11px] font-semibold text-dark/50 uppercase tracking-wider mb-2">Schritt 2 von 3 — Design</p>
<div class="space-y-3 mb-3">
<div><label class="text-[12px] font-semibold text-dark block mb-1">Logo / Design hochladen</label>
<div class="relative"><input type="file" name="datei" accept=".png,.jpg,.jpeg,.pdf,.ai,.eps,.svg" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" id="hero-file-input">
<div class="w-full bg-accent/[0.04] rounded-xl px-4 py-4 border-2 border-dashed border-accent/30 hover:border-accent/50 flex items-center gap-3 group" id="hero-file-label">
<div class="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><svg class="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
<div><span class="text-[13px] font-semibold text-accent block">Datei auswählen</span><span class="text-[11px] text-dark/30">PNG, JPG, PDF, AI, SVG — oder überspringen</span></div>
</div></div></div>
<div><label class="text-[12px] font-semibold text-dark block mb-1">Farbe</label>
<select name="farbe" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark appearance-none cursor-pointer" style="background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%230A0A0A%22 stroke-width=%221.5%22 viewBox=%220 0 24 24%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 12px center;background-size:14px;">
<option selected>Wie im Logo / Design</option><option>Warmweiß</option><option>Kaltweiß</option><option>Rot</option><option>Pink</option><option>Blau</option><option>Grün</option><option>RGB / Farbwechsel</option><option>Andere</option>
</select></div>
</div>
<div class="flex gap-2">
<button type="button" id="hero-back-2" class="flex items-center justify-center w-[44px] shrink-0 bg-dark/[0.04] border border-black/[0.06] rounded-xl hover:bg-dark/[0.08]"><svg class="w-4 h-4 text-dark/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
<button type="button" id="hero-next-2" class="flex-1 bg-accent text-white font-semibold text-[13px] py-3 rounded-xl hover:bg-accent/90 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(250,49,162,0.25)]">Weiter <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
</div>
</div>
<div id="hero-step-3" class="hf-step hidden">
<p class="text-[11px] font-semibold text-dark/50 uppercase tracking-wider mb-2">Schritt 3 von 3 — Kontakt</p>
<div class="space-y-2 mb-3">
<div class="grid grid-cols-2 gap-2">
<div><label class="text-[11px] font-semibold text-dark block mb-1">Name *</label><input type="text" name="name" id="hero-name" placeholder="Max Mustermann" required autocomplete="name" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
<div><label class="text-[11px] font-semibold text-dark block mb-1">Firma</label><input type="text" name="firma" placeholder="Unternehmen" autocomplete="organization" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
</div>
<div><label class="text-[11px] font-semibold text-dark block mb-1">E-Mail *</label><input type="email" name="email" id="hero-email" placeholder="max@firma.de" required autocomplete="email" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
<div><label class="text-[11px] font-semibold text-dark block mb-1">Telefon</label><input type="tel" name="telefon" placeholder="+49 ..." autocomplete="tel" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
</div>
<div class="flex gap-2">
<button type="button" id="hero-back-3" class="flex items-center justify-center w-[44px] shrink-0 bg-dark/[0.04] border border-black/[0.06] rounded-xl hover:bg-dark/[0.08]"><svg class="w-4 h-4 text-dark/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
<button type="submit" class="flex-1 bg-accent text-white font-semibold text-[13px] py-3 rounded-xl hover:bg-accent/90 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(250,49,162,0.25)]">Jetzt Angebot erhalten <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
</div>
<p class="text-[9px] font-medium text-dark/30 text-center mt-2">Kostenlos & unverbindlich · 4.9/5 Google · 2.156 B2B-Kunden</p>
</div>
</form></div>`;
}

function formEN(slug) {
  return `<div class="w-full max-w-[380px] mx-auto"><form action="/api/c" method="POST" enctype="multipart/form-data" id="hero-form" class="bg-white rounded-[16px] p-4 border border-black/5 shadow-[0_8px_40px_rgba(0,0,0,0.08)]" style="backdrop-filter:blur(20px);">
<input type="hidden" name="source" value="hero-form-${slug}">
<div class="nt-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
<div class="text-center mb-3" id="hero-form-header">
<h2 class="text-[17px] font-semibold text-dark tracking-[-0.03em] leading-tight">Get a Free Quote</h2>
<p class="text-[11px] font-medium text-dark/40 mt-0.5">3D preview + fixed-price quote in minutes</p>
</div>
<div class="flex items-center gap-1.5 mb-3">
<div class="flex-1 h-[3px] rounded-full bg-accent" id="hero-bar-1"></div>
<div class="flex-1 h-[3px] rounded-full bg-dark/[0.08]" id="hero-bar-2"></div>
<div class="flex-1 h-[3px] rounded-full bg-dark/[0.08]" id="hero-bar-3"></div>
</div>
<div id="hero-step-1" class="hf-step">
<p class="text-[11px] font-semibold text-dark/50 uppercase tracking-wider mb-2">Step 1 of 3 — Project</p>
<div class="space-y-3 mb-3">
<div><label class="text-[12px] font-semibold text-dark block mb-1">Product Type</label>
<select name="produkt" id="hero-produkt" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark appearance-none cursor-pointer" style="background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%230A0A0A%22 stroke-width=%221.5%22 viewBox=%220 0 24 24%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 12px center;background-size:14px;">
<option selected>LED Neon Sign</option><option value="3D Buchstaben (Front)">3D Channel Letters</option><option value="Leuchtkasten">Light Box</option><option value="Vollflächig beleuchtet">Fully Illuminated</option>
</select></div>
<div><label class="text-[12px] font-semibold text-dark block mb-1">Location</label>
<div class="grid grid-cols-2 gap-2">
<label class="flex items-center gap-2 bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent/5"><input type="radio" name="einsatzort" value="Indoor" checked class="accent-accent w-4 h-4"><span class="text-[13px] font-medium text-dark">Indoor</span></label>
<label class="flex items-center gap-2 bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent/5"><input type="radio" name="einsatzort" value="Outdoor" class="accent-accent w-4 h-4"><span class="text-[13px] font-medium text-dark">Outdoor</span></label>
</div></div>
<div><label class="text-[12px] font-semibold text-dark block mb-1">Desired Size</label>
<input type="text" name="groesse" placeholder="e.g. 100 cm width" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
</div>
<button type="button" id="hero-next-1" class="w-full bg-accent text-white font-semibold text-[13px] py-3 rounded-xl hover:bg-accent/90 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(250,49,162,0.25)]">Next <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
</div>
<div id="hero-step-2" class="hf-step hidden">
<p class="text-[11px] font-semibold text-dark/50 uppercase tracking-wider mb-2">Step 2 of 3 — Design</p>
<div class="space-y-3 mb-3">
<div><label class="text-[12px] font-semibold text-dark block mb-1">Upload Logo / Design</label>
<div class="relative"><input type="file" name="datei" accept=".png,.jpg,.jpeg,.pdf,.ai,.eps,.svg" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" id="hero-file-input">
<div class="w-full bg-accent/[0.04] rounded-xl px-4 py-4 border-2 border-dashed border-accent/30 hover:border-accent/50 flex items-center gap-3 group" id="hero-file-label">
<div class="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><svg class="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
<div><span class="text-[13px] font-semibold text-accent block">Choose file</span><span class="text-[11px] text-dark/30">PNG, JPG, PDF, AI, SVG — or skip</span></div>
</div></div></div>
<div><label class="text-[12px] font-semibold text-dark block mb-1">Color</label>
<select name="farbe" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark appearance-none cursor-pointer" style="background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%230A0A0A%22 stroke-width=%221.5%22 viewBox=%220 0 24 24%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 12px center;background-size:14px;">
<option selected>As in logo / design</option><option>Warm White</option><option>Cool White</option><option>Red</option><option>Blue</option><option>Green</option><option>RGB</option>
</select></div>
</div>
<div class="flex gap-2">
<button type="button" id="hero-back-2" class="flex items-center justify-center w-[44px] shrink-0 bg-dark/[0.04] border border-black/[0.06] rounded-xl hover:bg-dark/[0.08]"><svg class="w-4 h-4 text-dark/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
<button type="button" id="hero-next-2" class="flex-1 bg-accent text-white font-semibold text-[13px] py-3 rounded-xl hover:bg-accent/90 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(250,49,162,0.25)]">Next <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
</div>
</div>
<div id="hero-step-3" class="hf-step hidden">
<p class="text-[11px] font-semibold text-dark/50 uppercase tracking-wider mb-2">Step 3 of 3 — Contact</p>
<div class="space-y-2 mb-3">
<div class="grid grid-cols-2 gap-2">
<div><label class="text-[11px] font-semibold text-dark block mb-1">Name *</label><input type="text" name="name" id="hero-name" placeholder="John Smith" required autocomplete="name" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
<div><label class="text-[11px] font-semibold text-dark block mb-1">Company</label><input type="text" name="firma" placeholder="Company" autocomplete="organization" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
</div>
<div><label class="text-[11px] font-semibold text-dark block mb-1">E-Mail *</label><input type="email" name="email" id="hero-email" placeholder="john@company.com" required autocomplete="email" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
<div><label class="text-[11px] font-semibold text-dark block mb-1">Phone</label><input type="tel" name="telefon" placeholder="+49 ..." autocomplete="tel" class="w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-dark placeholder:text-dark/30"></div>
</div>
<div class="flex gap-2">
<button type="button" id="hero-back-3" class="flex items-center justify-center w-[44px] shrink-0 bg-dark/[0.04] border border-black/[0.06] rounded-xl hover:bg-dark/[0.08]"><svg class="w-4 h-4 text-dark/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
<button type="submit" class="flex-1 bg-accent text-white font-semibold text-[13px] py-3 rounded-xl hover:bg-accent/90 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(250,49,162,0.25)]">Get Your Quote <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
</div>
<p class="text-[9px] font-medium text-dark/30 text-center mt-2">Free & non-binding · 4.9/5 Google · 2,156 B2B clients</p>
</div>
</form></div>`;
}

// 3-step JS navigation (injected once, works for all)
const stepJS = `<script>
(function(){
var bars=[document.getElementById('hero-bar-1'),document.getElementById('hero-bar-2'),document.getElementById('hero-bar-3')];
var steps=[document.getElementById('hero-step-1'),document.getElementById('hero-step-2'),document.getElementById('hero-step-3')];
if(!bars[0]||!steps[0])return;
function goStep(n){
steps.forEach(function(s,i){s.classList.toggle('hidden',i!==n);});
bars.forEach(function(b,i){b.style.background=i<=n?'#fa31a2':'rgba(10,10,10,0.08)';});
}
var n1=document.getElementById('hero-next-1');if(n1)n1.onclick=function(){goStep(1);};
var n2=document.getElementById('hero-next-2');if(n2)n2.onclick=function(){goStep(2);};
var b2=document.getElementById('hero-back-2');if(b2)b2.onclick=function(){goStep(0);};
var b3=document.getElementById('hero-back-3');if(b3)b3.onclick=function(){goStep(1);};
var f=document.getElementById('hero-form');
if(f)f.onsubmit=function(e){
var name=document.getElementById('hero-name');
var email=document.getElementById('hero-email');
if(!name||!email)return;
if(!name.value.trim()||!email.value.trim()){e.preventDefault();if(!name.value.trim())name.focus();else email.focus();return;}
};
})();
</script>`;

// DE LPs
const deLPs = [
  { slug: 'neon-schilder', product: 'LED Neonschild' },
  { slug: 'led-schriftzuege', product: 'LED Neonschild' },
  { slug: 'leuchtbuchstaben', product: '3D Buchstaben (Front)' },
  { slug: 'firmenschilder', product: 'Vollflächig beleuchtet' },
  { slug: 'leuchtkaesten', product: 'Leuchtkasten' },
  { slug: 'leuchtreklame', product: 'LED Neonschild' },
  { slug: 'messe-event', product: 'LED Neonschild' },
  { slug: 'logo', product: 'LED Neonschild' },
];

let errors = [];

deLPs.forEach(lp => {
  let h = fs.readFileSync(`${lp.slug}/live-version.html`, 'utf8');

  // Fix padding
  h = h.replace(/pt-16 md:pt-32 pb-0 md:pb-28/g, 'pt-16 md:pt-32 pb-6 md:pb-28');
  h = h.replace(/pt-20 md:pt-32 pb-20 md:pb-28/g, 'pt-16 md:pt-32 pb-6 md:pb-28');
  h = h.replace(/pt-24 md:pt-32 pb-24 md:pb-28/g, 'pt-16 md:pt-32 pb-6 md:pb-28');

  // Find CTA button + trust line to replace
  const ctaIdx = h.indexOf('Jetzt kostenloses Angebot erhalten');
  if (ctaIdx === -1) { errors.push(`${lp.slug}: CTA not found`); return; }

  const tagStart = Math.max(h.lastIndexOf('<a ', ctaIdx), h.lastIndexOf('<button ', ctaIdx));
  const trustEnd = h.indexOf('Premium B2B', ctaIdx);
  if (trustEnd === -1) { errors.push(`${lp.slug}: Trust not found`); return; }
  const closingSpan = h.indexOf('</span>', trustEnd);
  const afterTrust = h.indexOf('</div>', closingSpan);

  const replaceBlock = h.substring(tagStart, afterTrust + 6);
  h = h.replace(replaceBlock, formDE(lp.slug, lp.product));

  // Inject step JS before </body>
  if (h.indexOf('hero-bar-1') > -1 && h.indexOf('goStep') === -1) {
    h = h.replace('</body>', stepJS + '</body>');
  }

  fs.writeFileSync(`${lp.slug}/index.html`, h);
  console.log(`✓ ${lp.slug}`);
});

// EN LP — different structure, form parent is hidden on mobile
let enH = fs.readFileSync('en/live-version.html', 'utf8');
enH = enH.replace(/pt-16 md:pt-32 pb-0 md:pb-28/g, 'pt-16 md:pt-32 pb-6 md:pb-28');

// The EN hero has the form in a div with "hidden lg:block"
// We need to either: make that visible, or inject a new form for mobile

// Strategy: Find the old desktop form wrapper and make it block (not hidden)
// Then replace its content with our new 3-step form
const hiddenFormIdx = enH.indexOf('hidden lg:block');
if (hiddenFormIdx > -1) {
  // Find the opening div before this class
  const divStart = enH.lastIndexOf('<div', hiddenFormIdx);
  // Replace "hidden lg:block" with "block" so it shows on mobile too
  enH = enH.substring(0, hiddenFormIdx) + 'block' + enH.substring(hiddenFormIdx + 'hidden lg:block'.length);

  // Now find and replace the old form with new EN form
  const oldFormStart = enH.indexOf('<form', hiddenFormIdx - 50);
  const oldFormEnd = enH.indexOf('</form>', oldFormStart) + 7;
  if (oldFormStart > -1 && oldFormEnd > 7) {
    const oldForm = enH.substring(oldFormStart, oldFormEnd);
    enH = enH.replace(oldForm, formEN('en').replace('<div class="w-full max-w-[380px] mx-auto">', '').replace(/<\/div>$/, ''));
  }

  // Also remove the old CTA mobile button if it exists
  // Find "Get a Free Quote" button in hero that's NOT in the form
  // This is the old hero CTA that we want to remove
}

// Inject step JS
if (enH.indexOf('hero-bar-1') > -1 && enH.indexOf('goStep') === -1) {
  enH = enH.replace('</body>', stepJS + '</body>');
}

fs.writeFileSync('en/index.html', enH);
console.log('✓ en');

if (errors.length) console.log('\nErrors:', errors.join(', '));
else console.log('\nAlle 9 LPs mit 3-Step-Form aktualisiert!');
