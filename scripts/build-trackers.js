#!/usr/bin/env node
/**
 * Cookie Monster — Tracker DB Builder
 * 
 * Fetches the latest Disconnect.me tracker list and transforms it
 * into the compressed data/tracker_db.json format used by the extension.
 * 
 * Run: node scripts/build-trackers.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DISCONNECT_URL = 'https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json';
const OUT_PATH = path.join(__dirname, '../data/tracker_db.json');

const CAT_MAP = {
  'Advertising':    'a',
  'Analytics':      'n',
  'Social':         't',
  'Disconnect':     't',
  'Content':        'f',
  'Cryptomining':   't',
  'Fingerprinting': 't',
};

const BIG_PLATFORM_OWNERS = new Set([
  'Google', 'Meta', 'Facebook', 'Microsoft', 'Amazon', 'Twitter',
  'LinkedIn', 'Adobe', 'Oracle', 'Salesforce', 'Apple', 'TikTok',
  'ByteDance', 'Snapchat', 'Pinterest', 'Yahoo', 'Verizon Media',
]);

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });
}

function extractRoot(domain) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const parts = clean.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : clean;
}

async function build() {
  console.log('Fetching Disconnect.me tracker list...');
  const raw = await fetch(DISCONNECT_URL);
  const data = JSON.parse(raw);

  const domains = {};
  const owners = {};

  for (const [catName, entities] of Object.entries(data.categories || {})) {
    const catCode = CAT_MAP[catName] || 'u';
    for (const entity of entities) {
      for (const [ownerName, ownerData] of Object.entries(entity)) {
        const isBig = [...BIG_PLATFORM_OWNERS].some(b => ownerName.includes(b));
        const typeCode = isBig ? 'b' : 'v';
        const shortOwner = ownerName.slice(0, 40);

        const domainList = Object.values(ownerData).flat().filter(d => typeof d === 'string');
        for (const domain of domainList) {
          const root = extractRoot(domain);
          if (root && root.includes('.')) {
            domains[root] = { o: shortOwner, c: catCode, t: typeCode };
          }
        }

        if (domainList.length > 0) {
          owners[shortOwner] = { c: catCode, t: typeCode };
        }
      }
    }
  }

  const output = {
    domains,
    owners,
    cat: { a: 'advertising', n: 'analytics', t: 'tracking', f: 'functional', u: 'unknown' },
    type: { v: 'vendor', b: 'big-platform' },
    version: new Date().toISOString().slice(0, 7),
    source: 'disconnect.me'
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 0));
  const size = fs.statSync(OUT_PATH).size;
  console.log(`✓ Written to ${OUT_PATH}`);
  console.log(`  Domains: ${Object.keys(domains).length}`);
  console.log(`  Owners:  ${Object.keys(owners).length}`);
  console.log(`  Size:    ${Math.round(size / 1024)} KB`);
}

build().catch(err => { console.error(err); process.exit(1); });
