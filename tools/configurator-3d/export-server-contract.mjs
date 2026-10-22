// Export the exact shared browser/server rules to the separate Offers repository.
// No client checkout toggle or second set of product rules is generated.
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const target=resolve(process.argv[2]||'');
if(!process.argv[2]||!target.endsWith('/lib/configurator-3d/generated'))throw Error('Pass the Offers lib/configurator-3d/generated directory');
const require=createRequire(resolve(target,'../../../package.json'));
const {build}=require('esbuild');
await mkdir(target,{recursive:true});
const result=await build({absWorkingDir:root,entryPoints:['functions/_shared/configurator-3d-drafts.js'],bundle:true,format:'esm',platform:'node',target:'node22',write:false,metafile:true,banner:{js:'// Generated from NEONTRIP 3D source. Edit source, then re-export.'}});
await writeFile(resolve(target,'core.mjs'),result.outputFiles[0].text);
const sources={};for(const path of Object.keys(result.metafile.inputs).sort()){const file=path.replace(/\?v=\d+$/,'');sources[file]=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex');}
await writeFile(resolve(target,'manifest.json'),JSON.stringify({sources,bundleSha256:createHash('sha256').update(result.outputFiles[0].contents).digest('hex')},null,2)+'\n');
