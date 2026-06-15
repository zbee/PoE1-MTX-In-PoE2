/**
 * PoE1-MTX-In-PoE2: A tool to shop PoE1 items for PoE2 with confidence.
 * Copyright (C) 2026  Ethan Henderson (zbee)
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of
 * the GNU General Public License as published by the Free Software Foundation, either version
 * 3 of the License, or (at your option) any later version.
 */

const POE2DB_BASE = 'https://poe2db.tw/us/';
const FETCH_TIMEOUT_MS = 5000;

// Cache TTL Constants (ms)
const CACHE_TTL_SUCCESS = 5 * 24 * 60 * 60 * 1000; // 5 Days
const CACHE_TTL_ERROR = 2 * 60 * 60 * 1000;        // 2 Hours

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Content-Type': 'application/json'
};

export default {
/**
 * @param {Request} request
 * @param {Object} env
 * @returns {Response}
 */
async fetch(request, env) {
if (request.method === 'OPTIONS') {
return new Response(null, { headers: CORS_HEADERS });
}

if (request.method !== 'GET') {
return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
}

const url = new URL(request.url);
const path = url.pathname.replace(/^\/+/, '');

if (path) {
return new Response('Invalid endpoint', { status: 404, headers: CORS_HEADERS });
}

const ids = url.searchParams.getAll('ids');
if (!ids || ids.length === 0) {
return new Response(JSON.stringify({ error: 'Missing IDs' }), { status: 400, headers: CORS_HEADERS });
}

try {
const results = await this.processBatch(ids, env);
return new Response(JSON.stringify(results.length === 1 ? results[0] : results), { headers: CORS_HEADERS });
} catch (err) {
return new Response(JSON.stringify({ error: err.message }), { status: 503, headers: CORS_HEADERS });
}
},

/**
 * Handles caching and fetching for a batch of IDs
 */
async processBatch(idsToCheck, env) {
const cachedResults = [];
const uncachedIds = [];

for (const id of idsToCheck) {
const cached = await env.POE_DB_CACHE.get(id, 'json');
if (cached && cached.timestamp) {
const ttl = cached.error ? CACHE_TTL_ERROR : CACHE_TTL_SUCCESS;
if (Date.now() - cached.timestamp < ttl) {
cachedResults.push({ id, ...cached });
continue;
}
}
uncachedIds.push(id);
}

if (uncachedIds.length > 0) {
const fresh = await Promise.all(uncachedIds.map(id => this.fetchAndParseOne(id)));
await Promise.all(fresh.map(r => env.POE_DB_CACHE.put(r.id, JSON.stringify(r))));
cachedResults.push(...fresh);
}

return idsToCheck.map(id => cachedResults.find(r => r.id === id)).filter(Boolean);
},

/**
 * Fetches and parses poe2db using Regex
 */
async fetchAndParseOne(id) {
const dbUrl = derivePoe2DBLink(id);
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

const result = {
id,
found: false,
available: false,
checkedUrl: dbUrl,
timestamp: Date.now(),
debug: {}
};

try {
const res = await fetch(dbUrl, {
signal: controller.signal,
headers: { 'User-Agent': 'PoE1-MTX-In-PoE2-Cacher', 'Accept': 'text/html' }
});

result.debug.httpStatus = res.status;

if (!res.ok) {
result.found = false;
result.error = `HTTP ${res.status}`;
result.debug.reason = 'http_error';
return result;
}

const html = await res.text();
result.debug.htmlLength = html.length;
result.found = true;

const hashFragment = `${id}Microtransaction`;
const tabStart = html.indexOf(`id="${hashFragment}`);

if (tabStart === -1) {
result.debug.tab_found = false;
result.error = 'Tab not found';
result.debug.reason = 'tab_missing';
return result;
}

const context = html.substring(tabStart, Math.min(tabStart + 2048, html.length));
result.debug.contextScanned = true;

const match = context.match(/<td[^>]*>Path of Exile 2<\/td>[\s\S]{0,500}?<td[^>]*>(.*?)<\/td>/i);

if (match) {
const val = match[1].trim();
result.debug.parsedValue = val;
result.available = (val === '1');
result.debug.reason = result.available ? 'available' : 'not_available';
} else {
result.debug.regexMatch = false;
result.error = 'PoE2 row not found';
result.debug.reason = 'parse_fail';
}
} catch (err) {
result.error = err.message;
result.debug.reason = 'network_error';
result.found = false;
result.available = false;
} finally {
clearTimeout(timeoutId);
}

return result;
}
};

function derivePoe2DBLink(id) {
const slug = id.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/^./, c => c.toUpperCase());
return `${POE2DB_BASE}${slug}`;
}
