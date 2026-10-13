// Build-time only. Source sections remain readable; the browser gets compact assets.
const fs = require('node:fs');
const { transformSync } = require('esbuild');
const { PurgeCSS } = require('purgecss');
const { optimize } = require('svgo');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
  const output = [];
  for (let { source, loader, content } of input) {
    if (loader === 'svg') {
      output.push(optimize(source, {multipass:true, plugins:[{name:'preset-default', params:{overrides:{cleanupIds:false}}}]}).data);
      continue;
    }
    if (content) {
      const [result] = await new PurgeCSS().purge({
        content: content.map(raw => ({raw, extension:'html'})),
        css:[{raw:source}],
        dynamicAttributes: [...new Set(content.flatMap(raw =>
          [...raw.matchAll(/\.dataset\.([A-Za-z]\w*)/g)].map(match =>
            'data-' + match[1].replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()))))],
        // Preserve Tailwind's decimal, responsive and arbitrary-value tokens too.
        defaultExtractor: raw => [...new Set([
          ...(raw.match(/[\w-/:]+(?<!:)/g) || []),
          ...(raw.match(/[^<>"'`\s=]+/g) || []),
        ])],
        // Interaction states are runtime-owned. Keep their rules and keyframes.
        safelist:{standard:[/^is-/, /^has-/, /^pgm-/, 'active', 'open', 'hidden', 'error', 'valid', 'invalid', 'dragging', 'instant'],
                  greedy:[/:scope/, /:root/]},
      });
      source = result.css;
    }
    output.push(transformSync(source, {
      loader, minify:true, legalComments:'none', charset:'utf8', target:['chrome110', 'safari16'],
    }).code);
  }
  process.stdout.write(JSON.stringify(output));
})().catch(error => { console.error(error); process.exit(1); });
