#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assertFile(path) {
  if (!existsSync(join(root, path))) fail(`missing required file: ${path}`);
}

function assertIncludes(path, needle, label = needle) {
  const content = read(path);
  if (!content.includes(needle)) fail(`${path} missing ${label}`);
}

function assertNotMatches(path, regex, label) {
  const content = read(path);
  if (regex.test(content)) fail(`${path} still has forbidden pattern: ${label}`);
}

function gitTracked(path) {
  try {
    const out = execFileSync('git', ['ls-files', '--', path], { cwd: root, encoding: 'utf8' }).trim();
    return out.split('\n').includes(path);
  } catch {
    return false;
  }
}

[
  'functions/api/c.js',
  'functions/api/r.js',
  'deploy/_source/layouts/base.html',
  'deploy/_source/sections/02-hero.html',
].forEach(assertFile);

['functions/api/c.js', 'functions/api/r.js'].forEach((path) => {
  if (!gitTracked(path)) fail(`${path} is not tracked by git`);
});

if (existsSync(join(root, 'deploy/.backup-pre-build'))) {
  fail('deploy/.backup-pre-build exists; remove it before deploy');
}

assertIncludes('functions/api/c.js', 'export async function onRequestPost', 'POST handler');
assertIncludes('functions/api/c.js', 'FAIL_REPORT_PATH = "/api/r"', 'fail-report path');
assertIncludes('functions/api/c.js', 'nt_dry_run', 'dry-run smoke support');
assertIncludes('functions/api/c.js', 'honeypot_prefilled_forwarded', 'honeypot false-positive forwarding');
assertIncludes('functions/api/r.js', 'N8N_FAIL_REPORT_WEBHOOK', 'fail alert webhook');
assertIncludes('functions/api/r.js', 'nt_dry_run', 'fail-alert dry-run smoke support');

assertIncludes('deploy/_source/layouts/base.html', 'window.ntPrepareSubmit', 'central submit preparation');
assertIncludes('deploy/_source/layouts/base.html', 'landing_page_url', 'landing_page_url capture');
assertIncludes('deploy/_source/layouts/base.html', '_landing_page_url', 'landing_page_url mirror');
assertIncludes('deploy/_source/layouts/base.html', 'current_page_url', 'current_page_url capture');
assertIncludes('deploy/_source/layouts/base.html', 'referrer', 'referrer capture');
assertIncludes('deploy/_source/layouts/base.html', '_referrer', 'referrer mirror');
assertIncludes('deploy/_source/layouts/base.html', 'ntReportSubmitFailure', 'fail-loud reporter');
assertIncludes('deploy/_source/layouts/base.html', '/api/r', 'fail endpoint');
assertNotMatches(
  'deploy/_source/layouts/base.html',
  /if\s*\([^)]*(?:formData|fd)\.get\(['"]website['"]\)[^)]*\)\s*\{?\s*(?:[^{};]+;)*\s*return\s*;?/,
  'client-side silent honeypot abort'
);

const generatedPages = readdirSync(join(root, 'deploy'))
  .filter((name) => !name.startsWith('.') && !['_source', 'assets'].includes(name))
  .map((name) => join('deploy', name, 'index.html'))
  .filter((path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile());

if (generatedPages.length === 0) fail('no generated deploy/*/index.html pages found');

for (const page of generatedPages) {
  const html = read(page);
  if (html.includes('fuajob.online/webhook/landing-anfrage')) {
    fail(`${page} posts directly to fuajob.online instead of same-origin /api/c`);
  }
  const hasLeadEndpoint = html.includes('/api/c');
  if (!hasLeadEndpoint) continue;
  if (!html.includes('/api/r')) fail(`${page} missing /api/r fail-report endpoint`);
  if (!html.includes('window.ntPrepareSubmit')) fail(`${page} missing central submit preparation`);
  if (!html.includes('landing_page_url')) fail(`${page} missing landing_page_url tracking`);
  if (!html.includes('_referrer')) fail(`${page} missing referrer mirror tracking`);
}

if (failures.length) {
  console.error('LP release verification FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`LP release verification passed (${generatedPages.length} generated pages checked).`);
