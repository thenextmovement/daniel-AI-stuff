// @ts-check
/**
 * LP Build Guard — Playwright structural + functional checks for every built NEONTRIP LP.
 *
 * Runs against a local static server (serve.js) pointed at deploy/.
 * Slug list is derived dynamically from deploy/_source/configs/*.json so new LPs
 * are automatically covered.
 *
 * Catches (based on real incidents):
 *  - dead anchor nav links (#anfrage-quick bug, 2026-04-09)
 *  - missing `novalidate` on forms (silent HTML5 validation abort, 2026-04-09)
 *  - wrong form action (post-ClickCease / Cloudflare proxy migration)
 *  - missing/broken Clarity tracking tag
 *  - console errors on page load
 *  - more than one `<h1>` (SEO)
 *  - missing viewport / canonical / meta description
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CONFIGS_DIR = path.resolve(__dirname, '..', 'configs');
const CLARITY_PROJECT_ID = 'vvb78gxiwp';
const EXPECTED_FORM_ACTION = '/api/c';

// Slugs that aren't built by node build.js or are test-only — skip
const SKIP_SLUGS = new Set(['test', 'test2']);

function loadConfigs() {
  return fs.readdirSync(CONFIGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, f), 'utf8')))
    .filter(cfg => cfg.slug && !SKIP_SLUGS.has(cfg.slug));
}

const CONFIGS = loadConfigs();
const SLUGS = CONFIGS.map(c => c.slug);
// Map slug → URL path (root-level pages use "/" instead of "/{slug}/")
const SLUG_PATHS = Object.fromEntries(
  CONFIGS.map(c => [c.slug, c.output_dir === '.' ? '/' : `/${c.slug}/`])
);

test.describe('LP Build Guard', () => {
  for (const slug of SLUGS) {
    test.describe(`/${slug}/`, () => {
      /** @type {string[]} */
      let consoleErrors = [];
      /** @type {string[]} */
      let pageErrors = [];

      test.beforeEach(async ({ page }) => {
        consoleErrors = [];
        pageErrors = [];
        page.on('console', msg => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', err => pageErrors.push(err.message));
        await page.goto(SLUG_PATHS[slug], { waitUntil: 'domcontentloaded' });
      });

      test('loads without console or page errors', async () => {
        // Known benign noise we can tolerate (e.g., 3rd-party tag failures in offline mode)
        const filter = (msg) =>
          !msg.includes('cookiebot') &&
          !msg.includes('clarity.ms') &&
          !msg.includes('googletagmanager') &&
          !msg.includes('google-analytics') &&
          !msg.includes('favicon') &&
          !msg.includes('net::ERR_');
        const realConsoleErrors = consoleErrors.filter(filter);
        const realPageErrors = pageErrors.filter(filter);
        expect(realPageErrors, 'page errors').toEqual([]);
        expect(realConsoleErrors, 'console errors').toEqual([]);
      });

      test('has exactly one h1', async ({ page }) => {
        const count = await page.locator('h1').count();
        expect(count).toBe(1);
      });

      test('has viewport + canonical + meta description', async ({ page }) => {
        await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
        await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
        const description = await page.locator('meta[name="description"]').getAttribute('content');
        expect(description, 'meta description').toBeTruthy();
        expect(description.length).toBeGreaterThan(20);
      });

      test('embeds Clarity tracking tag', async ({ page }) => {
        const html = await page.content();
        expect(html).toContain(CLARITY_PROJECT_ID);
      });

      test('all forms post to /api/c and have novalidate', async ({ page }) => {
        const forms = await page.locator('form').all();
        expect(forms.length, 'at least one form').toBeGreaterThan(0);
        for (const form of forms) {
          const action = await form.getAttribute('action');
          const novalidate = await form.getAttribute('novalidate');
          expect(action, 'form action').toBe(EXPECTED_FORM_ACTION);
          // novalidate is a boolean attribute — present (empty string or "novalidate") counts
          expect(novalidate, 'novalidate attr on form').not.toBeNull();
        }
      });

      test('all in-page anchor links have matching targets', async ({ page }) => {
        // Collect anchor hrefs AND check element existence all in browser context
        // so CSS.escape and document.getElementById are available.
        const missing = await page.evaluate(() => {
          const hrefs = Array.from(document.querySelectorAll('a[href^="#"]'))
            .map(a => a.getAttribute('href'))
            .filter(h => h && h !== '#');
          const uniq = [...new Set(hrefs)];
          return uniq.filter(href => !document.getElementById(href.slice(1)));
        });
        expect(missing, `anchor targets missing on /${slug}/`).toEqual([]);
      });

      test('hero has a visible H1 with non-empty text', async ({ page }) => {
        const h1 = page.locator('h1').first();
        await expect(h1).toBeVisible();
        const text = (await h1.textContent() || '').trim();
        expect(text.length).toBeGreaterThan(3);
      });
    });
  }
});
