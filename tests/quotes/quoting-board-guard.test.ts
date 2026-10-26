import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('quoting card-context guard regression suite',()=>{
 const env={...process.env}; delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../workflows/quoting-board-guard/board-guard.test.mjs',import.meta.url))],{env,encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/# pass 16/);
});
