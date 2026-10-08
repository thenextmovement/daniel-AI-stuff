export function calibratedSpan(photoWidth,points,lengthMm){
  if(!Number.isFinite(photoWidth)||photoWidth<=0||photoWidth>1000||!Array.isArray(points)||points.length!==2||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||!Number.isFinite(lengthMm)||lengthMm<=0)throw new Error('Bitte zwei Punkte und eine gültige Länge angeben.');
  const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
  if(distance<8)throw new Error('Die Punkte liegen zu nah beieinander. Wählen Sie eine längere Strecke.');
  const spanMm=photoWidth*lengthMm/distance;
  if(spanMm<500||spanMm>50000)throw new Error('Das Referenzmaß ergibt eine Bildbreite außerhalb von 50–5.000 cm. Bitte prüfen Sie Punkte und Länge.');
  return spanMm;
}

export function setupPhotoCalibration({getPhoto,onApply}){
  const $=s=>document.querySelector(s),ns='http://www.w3.org/2000/svg';
  const dialog=$('#calibration-dialog'),canvas=$('#calibration-image'),markers=$('#calibration-markers');
  let points=[],room,active=0,dragId=null;
  const limits=()=>({left:(1000-room.photoWidth)/2,right:(1000+room.photoWidth)/2,top:(500-room.photoHeight)/2,bottom:(500+room.photoHeight)/2});
  function bounded(p){const b=limits();return {x:Math.max(b.left,Math.min(b.right,p.x)),y:Math.max(b.top,Math.min(b.bottom,p.y))};}
  function element(tag,attrs,text){const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;return e;}
  function draw(){
    markers.replaceChildren();
    markers.append(element('line',{x1:points[0].x,y1:points[0].y,x2:points[1].x,y2:points[1].y,stroke:'white','stroke-width':3,'stroke-dasharray':'8 5'}));
    const screenScale=Math.max(.1,canvas.getBoundingClientRect().width/1000),radius=Math.max(23,18/screenScale);
    points.forEach((p,i)=>{
      const g=element('g',{'data-point':i,role:'button',tabindex:0,'aria-label':`Messpunkt ${i+1} verschieben: ziehen oder Pfeiltasten verwenden.`,transform:`translate(${p.x} ${p.y})`});
      g.append(element('circle',{r:Math.max(radius,24/screenScale),fill:'transparent'}),element('circle',{r:radius,fill:'#13151a',stroke:'#ff55b4','stroke-width':2/screenScale}),element('text',{'text-anchor':'middle','dominant-baseline':'central',fill:'white','font-size':Math.max(23,14/screenScale),'pointer-events':'none'},String(i+1)));markers.append(g);
    });
    validate();
  }
  function validate(){
    try{calibratedSpan(room.photoWidth,points,Number($('#reference-length').value)*10);$('#calibration-error').textContent='';$('#apply-calibration').disabled=false;}
    catch(error){$('#calibration-error').textContent=error.message;$('#apply-calibration').disabled=true;}
  }
  function local(event){return new DOMPoint(event.clientX,event.clientY).matrixTransform(canvas.getScreenCTM().inverse());}
  $('#calibrate-photo').addEventListener('click',()=>{
    room=getPhoto();if(!room)return;
    points=room.calibration?.points?.map(p=>({...p}))||[{x:500-room.photoWidth*.25,y:250},{x:500+room.photoWidth*.25,y:250}];
    $('#reference-length').value=room.calibration?room.calibration.lengthMm/10:'';
    const image=$('#calibration-photo');image.setAttribute('href',room.image);image.setAttribute('x',(1000-room.photoWidth)/2);image.setAttribute('y',(500-room.photoHeight)/2);image.setAttribute('width',room.photoWidth);image.setAttribute('height',room.photoHeight);
    $('#scene-dialog').close();dialog.showModal();draw();
  });
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const p=bounded(local(event)),target=event.target.closest('[data-point]');
    active=target?Number(target.dataset.point):Math.hypot(p.x-points[0].x,p.y-points[0].y)<=Math.hypot(p.x-points[1].x,p.y-points[1].y)?0:1;
    points[active]=p;dragId=event.pointerId;canvas.setPointerCapture(dragId);event.preventDefault();draw();
  });
  canvas.addEventListener('pointermove',event=>{if(event.pointerId===dragId){points[active]=bounded(local(event));draw();}});
  function finish(event){if(event.pointerId===dragId){dragId=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}}
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('keydown',event=>{
    const target=event.target.closest('[data-point]');if(!target||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const i=Number(target.dataset.point),p=points[i],step=event.shiftKey?10:1;
    points[i]=bounded({x:p.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:p.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)});draw();markers.querySelector(`[data-point="${i}"]`).focus();
  });
  window.addEventListener('resize',()=>{if(dialog.open)draw();});
  $('#reference-length').addEventListener('input',validate);
  $('#apply-calibration').addEventListener('click',()=>{
    try{const lengthMm=Number($('#reference-length').value)*10,spanMm=calibratedSpan(room.photoWidth,points,lengthMm);onApply({spanMm,calibration:{points:points.map(p=>({...p})),lengthMm}});dialog.close();}
    catch(error){$('#calibration-error').textContent=error.message;}
  });
}
