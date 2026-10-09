import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const container = process.env.CLOUDKIT_CONTAINER || 'iCloud.Gary.Strain-Diary-optimized';
const environment = process.env.CLOUDKIT_ENVIRONMENT || 'production';
const keyID = process.env.CLOUDKIT_KEY_ID;
const privateKeyText = process.env.CLOUDKIT_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!keyID || !privateKeyText) {
  throw new Error('CLOUDKIT_KEY_ID and CLOUDKIT_PRIVATE_KEY are required');
}

const privateKey = createPrivateKey(privateKeyText);
const requestPath = `/database/1/${container}/${environment}/public/records/query`;
const requestURL = `https://api.apple-cloudkit.com${requestPath}`;

const isoDate = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const bodyHash = body => createHash('sha256').update(body).digest('base64');

async function queryPage(recordType, desiredKeys, continuationMarker) {
  const request = {
    query: { recordType },
    desiredKeys,
    resultsLimit: 200,
  };
  if (continuationMarker) request.continuationMarker = continuationMarker;
  const body = JSON.stringify(request);
  const date = isoDate();
  const message = `${date}:${bodyHash(body)}:${requestPath}`;
  const signature = sign('sha256', Buffer.from(message), privateKey).toString('base64');
  const response = await fetch(requestURL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Apple-CloudKit-Request-KeyID': keyID,
      'X-Apple-CloudKit-Request-ISO8601Date': date,
      'X-Apple-CloudKit-Request-SignatureV1': signature,
    },
    body,
  });
  const data = await response.json();
  if (!response.ok || data.serverErrorCode) {
    throw new Error(`CloudKit ${recordType} query failed: ${response.status} ${data.reason || data.serverErrorCode || response.statusText}`);
  }
  return data;
}

async function fetchRecords(recordType, desiredKeys) {
  const records = [];
  let continuationMarker;
  do {
    const page = await queryPage(recordType, desiredKeys, continuationMarker);
    records.push(...(page.records || []).filter(record => !record.serverErrorCode));
    continuationMarker = page.continuationMarker;
  } while (continuationMarker && records.length < 25000);
  return records;
}

const field = (record, name) => record?.fields?.[name]?.value;
const text = value => typeof value === 'string' ? value.trim() : '';
const list = value => {
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,;/|]/).map(item => item.trim()).filter(Boolean);
  return [];
};
const flavors = value => list(value).filter(item => !item.startsWith('__'));
const publicFlag = value => value === true || value === 1 || value === '1';
const keyFor = value => text(value).toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const unique = values => [...new Map(values.map(value => [value.toLocaleLowerCase('en-US'), value])).values()];

function normalizedEntry(entry) {
  return {
    name: text(entry.name),
    type: text(entry.type),
    crosses: text(entry.crosses),
    terpenes: unique(list(entry.terpenes)),
    flavors: unique(flavors(entry.flavors)),
    effects: unique(list(entry.effects)),
  };
}

function mergeEntry(existing, incoming) {
  if (!existing) return normalizedEntry(incoming);
  return {
    name: existing.name || incoming.name,
    type: existing.type || text(incoming.type),
    crosses: existing.crosses || text(incoming.crosses),
    terpenes: unique([...existing.terpenes, ...list(incoming.terpenes)]),
    flavors: unique([...existing.flavors, ...flavors(incoming.flavors)]),
    effects: unique([...existing.effects, ...list(incoming.effects)]),
  };
}

const bundled = JSON.parse(await readFile('strain-library-bundled.json', 'utf8'));
const community = await fetchRecords('CommunityStrain', [
  'strainName', 'displayName', 'brand', 'crosses', 'terpenes', 'terpProfiles', 'effects',
]);
const publicPosts = await fetchRecords('PublicStrain', [
  'name', 'brand', 'type', 'crosses', 'terpenes', 'terpProfiles', 'effects', 'isPublic',
]);

const merged = new Map();
for (const entry of bundled) {
  const normalized = normalizedEntry(entry);
  const key = keyFor(normalized.name);
  if (key) merged.set(key, mergeEntry(merged.get(key), normalized));
}
for (const record of community) {
  const entry = {
    name: text(field(record, 'displayName')) || text(field(record, 'strainName')),
    crosses: field(record, 'crosses'),
    terpenes: field(record, 'terpenes'),
    flavors: field(record, 'terpProfiles'),
    effects: field(record, 'effects'),
  };
  const key = keyFor(entry.name);
  if (key) merged.set(key, mergeEntry(merged.get(key), entry));
}
let publicRecordCount = 0;
for (const record of publicPosts) {
  if (!publicFlag(field(record, 'isPublic'))) continue;
  publicRecordCount += 1;
  const entry = {
    name: field(record, 'name'),
    type: field(record, 'type'),
    crosses: field(record, 'crosses'),
    terpenes: field(record, 'terpenes'),
    flavors: field(record, 'terpProfiles'),
    effects: field(record, 'effects'),
  };
  const key = keyFor(entry.name);
  if (key) merged.set(key, mergeEntry(merged.get(key), entry));
}

const catalog = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
const metadata = {
  total: catalog.length,
  bundledRecords: bundled.length,
  communityRecords: community.length,
  publicRecords: publicRecordCount,
  generatedAt: new Date().toISOString(),
};

await writeFile('strain-library.json', `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile('strain-library-meta.json', `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Wrote ${catalog.length.toLocaleString('en-US')} unique public strain profiles`, metadata);
