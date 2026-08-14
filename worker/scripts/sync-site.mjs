/* Copies the website into worker/public. The site source is the single
   truth — internal checkout is always on since the Fresha retirement.
   Run after any site edit: `node scripts/sync-site.mjs` then `npx wrangler deploy` */
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const worker = dirname(dirname(fileURLToPath(import.meta.url)));
const site = dirname(worker);
const pub = join(worker, 'public');

mkdirSync(pub, { recursive: true });
cpSync(join(site, 'index.html'), join(pub, 'index.html'));
cpSync(join(site, 'styles.css'), join(pub, 'styles.css'));
cpSync(join(site, 'main.js'), join(pub, 'main.js'));
cpSync(join(site, 'robots.txt'), join(pub, 'robots.txt'));
cpSync(join(site, 'sitemap.xml'), join(pub, 'sitemap.xml'));
cpSync(join(site, 'fonts'), join(pub, 'fonts'), { recursive: true });

console.log('Site synced to worker/public.');
