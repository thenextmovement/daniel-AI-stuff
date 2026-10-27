import{readFileSync}from'node:fs';import{test}from'node:test';import assert from'node:assert/strict';
const p=JSON.parse(readFileSync(new URL('./send-parameters.json',import.meta.url),'utf8'));
const render=json=>new Function('$json','return '+p.bodyContent.slice(3,-3))(json);
test('HTML body sent as HTML without escaping tags',()=>{assert.equal(p.additionalFields.bodyContentType,'html');assert.equal(render({emailBody:'<h2>Zahlung eingegangen</h2><p>21.211,75 €</p>'}),'<h2>Zahlung eingegangen</h2><p>21.211,75 €</p>');});
test('plain messages retain lines and escape customer markup',()=>{const h=render({emailBody:'Zeile 1\nFirma <Test> & Co\nZeile 3<hr><p>Hinweis</p>'});assert.match(h,/white-space:pre-line/);assert.match(h,/&lt;Test&gt; &amp; Co/);assert.match(h,/<hr><p>Hinweis/);});
test('body_html fallback',()=>assert.equal(render({body_html:'<p>Fallback</p>'}),'<p>Fallback</p>'));
test('unreconciled balance is not a confirmed demand',()=>{const code=readFileSync(new URL('./validate-order.js',import.meta.url),'utf8');new Function('$input','$',code);assert.match(code,/noch keine bestätigte offene Forderung/);assert.doesNotMatch(code,/<strong>Noch offen:/);});

