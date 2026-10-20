import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const container = process.env.CLOUDKIT_CONTAINER || 'iCloud.Gary.Strain-Diary-optimized';
const environment = process.env.CLOUDKIT_ENVIRONMENT || 'production';
const keyID = process.env.CLOUDKIT_KEY_ID;
const rawKey = process.env.CLOUDKIT_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
const compactKey = rawKey?.replace(/\s/g, '') || '';
const privateKeyText = rawKey && !rawKey.includes('BEGIN') && /^[A-Za-z0-9+/=]+$/.test(compactKey)
  ? `-----BEGIN EC PRIVATE KEY-----\n${compactKey.match(/.{1,64}/g).join('\n')}\n-----END EC PRIVATE KEY-----`
  : rawKey;

if (!keyID || !privateKeyText) throw new Error('CloudKit credentials are required');
const privateKey = createPrivateKey(privateKeyText);
const requestPath = `/database/1/${container}/${environment}/public/records/query`;
const requestURL = `https://api.apple-cloudkit.com${requestPath}`;
const isoDate = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const hashBody = body => createHash('sha256').update(body).digest('base64');

async function queryPage(marker) {
  const request = {
    query: { recordType: 'EducationPost' },
    desiredKeys: ['title', 'body', 'author', 'category', 'blocksJSON'],
    resultsLimit: 200,
  };
  if (marker) request.continuationMarker = marker;
  const body = JSON.stringify(request);
  const date = isoDate();
  const signature = sign('sha256', Buffer.from(`${date}:${hashBody(body)}:${requestPath}`), privateKey).toString('base64');
  const response = await fetch(requestURL, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      'X-Apple-CloudKit-Request-KeyID': keyID,
      'X-Apple-CloudKit-Request-ISO8601Date': date,
      'X-Apple-CloudKit-Request-SignatureV1': signature,
    },
    body,
  });
  const data = await response.json();
  if (!response.ok || data.serverErrorCode) {
    throw new Error(`CloudKit EducationPost query failed: ${response.status} ${data.reason || data.serverErrorCode || response.statusText}`);
  }
  return data;
}

const value = (record, key) => record?.fields?.[key]?.value;
const clean = input => typeof input === 'string' ? input.trim() : '';
const escapeHTML = input => String(input ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const stripHTML = input => clean(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const slugify = input => stripHTML(input).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'cannabis-guide';
const shortID = input => createHash('sha1').update(input).digest('hex').slice(0, 8);
const dateFrom = raw => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const date = new Date(n < 100000000000 ? n * 1000 : n);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};
const displayDate = iso => iso ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso)) : '';

function blocksFor(record) {
  const fallback = clean(value(record, 'body'));
  const raw = clean(value(record, 'blocksJSON'));
  if (!raw) return fallback ? [{ type: 'text', value: fallback }] : [];
  try {
    const parsed = JSON.parse(raw);
    const textBlocks = parsed.filter(block => block?.type === 'text' && clean(block.value))
      .map(block => ({ type: 'text', value: clean(block.value) }));
    return textBlocks.length ? textBlocks : (fallback ? [{ type: 'text', value: fallback }] : []);
  } catch {
    return fallback ? [{ type: 'text', value: fallback }] : [];
  }
}

const records = [];
let marker;
do {
  const page = await queryPage(marker);
  records.push(...(page.records || []).filter(record => !record.serverErrorCode));
  marker = page.continuationMarker;
} while (marker && records.length < 10000);

const posts = records.map(record => {
  const id = record.recordName || record.record?.recordName || shortID(JSON.stringify(record));
  const title = clean(value(record, 'title'));
  const blocks = blocksFor(record);
  const body = clean(value(record, 'body')) || blocks.map(block => block.value).join('\n\n');
  const publishedAt = dateFrom(record?.created?.timestamp || record?.modified?.timestamp);
  const updatedAt = dateFrom(record?.modified?.timestamp) || publishedAt;
  return {
    id,
    title,
    body,
    author: clean(value(record, 'author')) || 'Strain Diary',
    category: clean(value(record, 'category')) || 'Other',
    blocks,
    publishedAt,
    updatedAt,
    slug: `${slugify(title)}-${shortID(id)}`,
  };
}).filter(post => post.title && post.body)
  .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

const siteHeader = active => `<header>
  <a class="brand" href="/"><img src="/assets/app-icon-small.webp" width="38" height="38" alt=""><span>Strain Diary</span></a>
  <nav><a href="/">Home</a><a href="/features.html">Features</a><a href="/cannabis-journal.html">Journal guide</a><a ${active ? 'class="active-link" aria-current="page"' : ''} href="/education.html">Education</a><a href="/contact.html">Contact Us</a></nav>
  <div class="header-actions"><a class="social-button" href="https://www.instagram.com/strain_diary_/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4.25"></circle><circle class="instagram-dot" cx="17.4" cy="6.7" r="1"></circle></svg></a><button class="mobile-menu-button" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button><a class="nav-cta" href="/beta.html">Early access ↗</a></div>
</header>`;

const siteFooter = `<footer class="site-footer">
  <div class="footer-main">
    <div class="footer-brand"><a class="brand" href="/"><img src="/assets/app-icon-small.webp" width="38" height="38" alt=""><span>Strain Diary</span></a><p>A private cannabis journal for remembering what you tried and what was worth trying again.</p><a class="footer-instagram" href="https://www.instagram.com/strain_diary_/" target="_blank" rel="noopener noreferrer" aria-label="Follow Strain Diary on Instagram"><span>Follow for updates ↗</span></a></div>
    <div class="footer-column"><strong>Explore</strong><a href="/">Home</a><a href="/features.html">Features</a><a href="/cannabis-journal.html">Journal guide</a><a href="/education.html">Education</a><a href="/our-story.html">Our story</a></div>
    <div class="footer-column"><strong>Get in touch</strong><a href="/beta.html">Get early access</a><a href="/contact.html">Contact us</a><a href="mailto:support@straindiary.com">Email support</a></div>
    <div class="footer-column"><strong>Good to know</strong><a href="/privacy-policy.html">Privacy policy</a><span>21+ only</span><span>Not medical advice</span></div>
  </div>
  <div class="footer-bottom"><span>© 2026 Strain Diary. All rights reserved.</span><span>Private by default · No ads · No data sold</span></div>
</footer>`;

const sharedHead = `<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&amp;family=Manrope:wght@600;700;800&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/preview.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/pages.css"><link rel="stylesheet" href="/footer.css">
<style>
.edu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:28px}.edu-card{display:flex;flex-direction:column;gap:12px;padding:26px;border:1px solid var(--line,#315342);border-radius:24px;background:rgba(255,255,255,.035);color:inherit;text-decoration:none;transition:transform .18s ease,border-color .18s ease}.edu-card:hover{transform:translateY(-3px);border-color:var(--accent,#bdf45b)}.edu-card h2{font-size:clamp(1.25rem,2vw,1.7rem);margin:0}.edu-card p{margin:0;color:var(--muted,#9bad9f)}.edu-meta{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;color:var(--accent,#bdf45b)}.edu-search{width:100%;box-sizing:border-box;margin-top:28px;padding:16px 18px;border:1px solid var(--line,#315342);border-radius:16px;background:rgba(255,255,255,.04);color:inherit;font:inherit}.edu-article{max-width:820px;margin:0 auto}.edu-article .article-body{font-size:1.08rem;line-height:1.8}.edu-article .article-body p{margin:0 0 1.35em}.edu-disclaimer{margin-top:34px;padding:20px;border:1px solid var(--line,#315342);border-radius:18px;color:var(--muted,#9bad9f)}@media(max-width:720px){.edu-grid{grid-template-columns:1fr}.edu-card{padding:22px}}
</style>`;

const collectionJSONLD = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Cannabis Education Library',
  url: 'https://straindiary.com/education.html',
  description: 'Clear cannabis education about terpenes, cannabinoids, product labels, concentrates, safety and common questions.',
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: posts.length,
    itemListElement: posts.map((post, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `https://straindiary.com/education/${post.slug}.html`,
      name: post.title,
    })),
  },
};

const cards = posts.map(post => {
  const excerpt = stripHTML(post.body).slice(0, 190);
  return `<a class="edu-card" href="/education/${post.slug}.html" data-search="${escapeHTML((post.title + ' ' + post.category + ' ' + post.body).toLowerCase())}">
    <span class="edu-meta">${escapeHTML(post.category)}${post.publishedAt ? ` · ${escapeHTML(displayDate(post.publishedAt))}` : ''}</span>
    <h2>${escapeHTML(post.title)}</h2><p>${escapeHTML(excerpt)}${excerpt.length >= 190 ? '…' : ''}</p><strong>Read guide →</strong>
  </a>`;
}).join('\n');

const indexHTML = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannabis Education and Weed Questions | Strain Diary</title>
<meta name="description" content="Get clear answers to cannabis questions. Learn about terpenes, cannabinoids, product labels, concentrates, safety and strain tracking with Strain Diary.">
<meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="https://straindiary.com/education.html">
<meta property="og:type" content="website"><meta property="og:url" content="https://straindiary.com/education.html"><meta property="og:title" content="Cannabis Education and Weed Questions | Strain Diary"><meta property="og:description" content="Clear, practical cannabis guides from Strain Diary.">
${sharedHead}<script type="application/ld+json">${JSON.stringify(collectionJSONLD).replace(/</g, '\\u003c')}</script></head><body>
${siteHeader(true)}<main class="inner-page"><section class="page-hero"><p class="kicker">CANNABIS EDUCATION</p><h1>Clear answers to cannabis questions.</h1><p>Explore practical guides about terpenes, cannabinoids, product labels, concentrates, safety, flavors and keeping better strain notes. New posts added in Strain Diary appear here automatically.</p>
<input class="edu-search" id="education-search" type="search" placeholder="Search cannabis guides" aria-label="Search cannabis guides"></section>
<section class="page-shell content-pad"><div class="edu-grid" id="education-grid">${cards || '<p>Education guides are being prepared. Check back soon.</p>'}</div>
<section class="page-cta"><h2>Remember what works for you.</h2><p>Use Strain Diary to save strains, flavors, terpenes, effects and ratings in one private cannabis journal.</p><a class="button" href="/beta.html">Get early access ↗</a></section></section></main>
${siteFooter}<script src="/theme.js"></script><script>const q=document.getElementById('education-search');q?.addEventListener('input',()=>{const term=q.value.trim().toLowerCase();document.querySelectorAll('.edu-card').forEach(card=>{card.hidden=term&&!card.dataset.search.includes(term)})});</script></body></html>`;

await rm('education', { recursive: true, force: true });
await mkdir('education', { recursive: true });
await writeFile('education.html', indexHTML);

for (const post of posts) {
  const description = stripHTML(post.body).slice(0, 155);
  const paragraphs = post.blocks.map(block => `<p>${escapeHTML(block.value).replace(/\n/g, '<br>')}</p>`).join('\n');
  const articleJSONLD = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description,
    datePublished: post.publishedAt || undefined,
    dateModified: post.updatedAt || post.publishedAt || undefined,
    author: { '@type': 'Organization', name: post.author || 'Strain Diary' },
    publisher: { '@type': 'Organization', name: 'Strain Diary', url: 'https://straindiary.com/' },
    mainEntityOfPage: `https://straindiary.com/education/${post.slug}.html`,
    articleSection: post.category,
  };
  const html = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(post.title)} | Cannabis Education | Strain Diary</title><meta name="description" content="${escapeHTML(description)}"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="https://straindiary.com/education/${post.slug}.html"><meta property="og:type" content="article"><meta property="og:url" content="https://straindiary.com/education/${post.slug}.html"><meta property="og:title" content="${escapeHTML(post.title)}"><meta property="og:description" content="${escapeHTML(description)}">
${sharedHead}<script type="application/ld+json">${JSON.stringify(articleJSONLD).replace(/</g, '\\u003c')}</script></head><body>
${siteHeader(true)}<main class="inner-page"><article class="page-shell content-pad edu-article"><a href="/education.html">← All cannabis guides</a><header class="page-hero"><p class="kicker">${escapeHTML(post.category)}</p><h1>${escapeHTML(post.title)}</h1><p>${escapeHTML(post.author)}${post.publishedAt ? ` · ${escapeHTML(displayDate(post.publishedAt))}` : ''}</p></header>
<div class="article-body">${paragraphs}</div><p class="edu-disclaimer">For educational purposes only. Not Medical Advice. Cannabis laws vary by location.</p>
<section class="page-cta"><h2>Save what you learn.</h2><p>Track strains, flavors, terpenes, effects and ratings with Strain Diary.</p><a class="button" href="/beta.html">Get early access ↗</a></section></article></main>${siteFooter}<script src="/theme.js"></script></body></html>`;
  await writeFile(`education/${post.slug}.html`, html);
}

await writeFile('education-posts.json', JSON.stringify({ generatedAt: new Date().toISOString(), total: posts.length, posts }, null, 2) + '\n');

const sitemapPath = 'sitemap.xml';
let sitemap = await readFile(sitemapPath, 'utf8');
sitemap = sitemap.replace(/\s*<url><loc>https:\/\/straindiary\.com\/education\/[^<]+<\/loc>.*?<\/url>/gs, '');
sitemap = sitemap.replace(/<url><loc>https:\/\/straindiary\.com\/education\.html<\/loc><lastmod>[^<]+<\/lastmod><\/url>/,
  `<url><loc>https://straindiary.com/education.html</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`);
const urls = posts.map(post => `  <url><loc>https://straindiary.com/education/${post.slug}.html</loc><lastmod>${(post.updatedAt || post.publishedAt || new Date().toISOString()).slice(0, 10)}</lastmod></url>`).join('\n');
sitemap = sitemap.replace('</urlset>', `${urls ? '\n' + urls : ''}\n</urlset>`);
await writeFile(sitemapPath, sitemap);
console.log(`Generated ${posts.length} crawlable education articles from CloudKit`);
