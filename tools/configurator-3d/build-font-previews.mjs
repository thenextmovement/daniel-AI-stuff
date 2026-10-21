import {readFile,writeFile} from 'node:fs/promises';
import {FontLoader} from '../../deploy/3d-konfigurator/vendor/FontLoader.js';
import {layoutLetters} from '../../deploy/3d-konfigurator/renderer.js';
import {FONTS} from '../../deploy/3d-konfigurator/model.js';
for(const id of Object.keys(FONTS)){
 const font=new FontLoader().parse(JSON.parse(await readFile(new URL(`../../deploy/3d-konfigurator/fonts/${id}.json`,import.meta.url),'utf8')));
 const {shapes,width,height}=layoutLetters(font,'Aa',2);
 const paths=shapes.map(({shape,x,y})=>`<path d="${[shape,...shape.holes].map(contour=>contour.getPoints(16).map((p,i)=>`${i?'L':'M'}${(p.x+x).toFixed(2)} ${(-p.y-y).toFixed(2)}`).join(' ')+'Z').join(' ')}"/>`).join('');
 await writeFile(new URL(`../../deploy/3d-konfigurator/fonts/${id}.svg`,import.meta.url),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-width/2-2} ${-height/2-2} ${width+4} ${height+4}" fill="#251f1b" fill-rule="evenodd">${paths}</svg>\n`);
}
