// Strain Diary live competition Cloudflare Worker.
// This Worker is intentionally separate from the existing review-page Worker.
// Secret required: CK_API_TOKEN

const CLOUDKIT_RECORDS = "https://api.apple-cloudkit.com/database/1/iCloud.Gary.Strain-Diary-optimized/production/public/records";
const ALLOWED_ORIGIN = "https://straindiary.com";
const CODE_PATTERN = /^[A-Z0-9]{4,8}$/;
const MAX_SCORECARDS = 5000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Vary": "Origin",
    };

    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: "forbidden" }, 403, cors, "no-store");
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type", "Access-Control-Max-Age": "600" } });
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/presenter/")) return presenterRoute(request, env, cors);
    if (request.method !== "GET") {
      return json({ error: "method" }, 405, cors, "no-store");
    }

    const code = (url.searchParams.get("code") || "").trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      return json({ error: "invalid code" }, 400, cors, "no-store");
    }
    if (!env.CK_API_TOKEN) {
      return json({ error: "configuration" }, 500, cors, "no-store");
    }

    try {
      const competitionRecord = await lookupRecord(env, `competition-${code}`, ["configKey", "homeURL"]);
      const competition = parseCompetition(competitionRecord, code);
      if (!competition) {
        return json({ error: "not found" }, 404, cors, "public, max-age=15");
      }

      if (url.searchParams.get("photo") === "1") {
        return await photoResponse(env, competition, code, cors);
      }

      const ceremony = await getCeremonyState(env, code);
      if (url.pathname === "/ceremony") return json({ ceremonyDone: competition.resultsPublic || ceremony.ceremonyDone }, 200, cors, "no-store");
      const scorecardRecords = await queryScorecards(env, code);
      const output = buildSafeResponse(competition, scorecardRecords);
      const done = competition.resultsPublic || ceremony.ceremonyDone;
      if (competition.judgingOpen || !done) {
        const full = output.entries;
        output.entries = full.map(entry => ({
          number: entry.number, category: entry.category, catNumber: entry.catNumber,
          label: entry.category + " #" + entry.catNumber, judgeCount: entry.judgeCount, scoredBy: entry.scoredBy,
        })).sort((a, b) => compareEntryNumbers(a.number, b.number));
        const revealed = [];
        for (const award of competition.judgingOpen ? [] : ceremony.revealed || []) {
          const entry = full.find(item => String(item.number) === String(award.number));
          if (!entry) continue;
          const raw = competition.entries.find(item => String(item.number) === String(award.number));
          const privateName = ceremony.names?.[String(award.number)];
          revealed.push({
            category: entry.category, place: award.place, label: entry.category + " #" + entry.catNumber,
            catNumber: entry.catNumber, total: entry.total,
            strain: competition.blind && !competition.revealed ? cleanText(privateName?.strain) || null : cleanText(raw?.strain) || null,
            brand: competition.blind && !competition.revealed ? cleanText(privateName?.brand) || null : cleanText(raw?.brand) || null,
            at: award.at,
          });
        }
        output.presenter = { ceremonyDone: done, revealed };
      } else output.presenter = { ceremonyDone: done, revealed: [] };
      return json(output, 200, cors, "public, max-age=15");
    } catch (error) {
      console.error("Live competition upstream error", error instanceof Error ? error.message : error);
      return json({ error: "upstream" }, 502, cors, "no-store");
    }
  },
};

async function cloudKit(env, operation, body) {
  const endpoint = `${CLOUDKIT_RECORDS}/${operation}?ckAPIToken=${encodeURIComponent(env.CK_API_TOKEN)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Origin": ALLOWED_ORIGIN,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.serverErrorCode) {
    const reason = data?.reason || data?.serverErrorCode || `HTTP ${response.status}`;
    throw new Error(`CloudKit ${operation} failed: ${reason}`);
  }
  return data;
}

async function lookupRecord(env, recordName, desiredKeys) {
  const data = await cloudKit(env, "lookup", {
    records: [{ recordName }],
    desiredKeys,
  });
  const record = data.records?.[0];
  if (!record || record.serverErrorCode) return null;
  return record;
}

async function queryScorecards(env, code) {
  const records = [];
  let continuationMarker;

  do {
    const body = {
      query: {
        recordType: "AdminConfig",
        filterBy: [{
          fieldName: "configKey",
          comparator: "EQUALS",
          fieldValue: { value: `compCard:${code}` },
        }],
      },
      desiredKeys: ["configKey", "homeURL"],
      resultsLimit: 200,
    };
    if (continuationMarker) body.continuationMarker = continuationMarker;

    const page = await cloudKit(env, "query", body);
    for (const record of page.records || []) {
      if (!record.serverErrorCode) records.push(record);
    }
    continuationMarker = page.continuationMarker;
    if (continuationMarker && records.length >= MAX_SCORECARDS) {
      throw new Error("Scorecard safety limit exceeded");
    }
  } while (continuationMarker);

  return records;
}

function parseCompetition(record, requestedCode) {
  if (!record || field(record, "configKey") !== "competition") return null;
  const value = parseJSON(field(record, "homeURL"));
  if (!isObject(value)) return null;
  const code = cleanText(value.code).toUpperCase();
  if (code && code !== requestedCode) return null;
  const rawEndsAt = cleanText(value.judgingEndsAt);
  const judgingEndsAt = rawEndsAt && Number.isFinite(Date.parse(rawEndsAt)) ? new Date(rawEndsAt).toISOString() : null;

  return {
    code: requestedCode,
    title: cleanText(value.title) || `Competition ${requestedCode}`,
    hostName: cleanText(value.hostName),
    hostDisplayName: cleanText(value.hostDisplayName),
    creator: cleanText(record.created?.userRecordName),
    blind: value.blind === true,
    revealed: value.revealed === true,
    judgingOpen: value.judgingOpen === true && (judgingEndsAt === null || Date.now() < Date.parse(judgingEndsAt)),
    judgingEndsAt,
    criteria: Array.isArray(value.criteria) ? value.criteria : [],
    checklist: Array.isArray(value.checklist) ? value.checklist : [],
    checklistWeight: typeof value.checklistWeight === "number" && Number.isFinite(value.checklistWeight) && value.checklistWeight > 0 ? value.checklistWeight : 0,
    entries: Array.isArray(value.entries) ? value.entries : [],
    removedJudges: Array.isArray(value.removedJudges) ? value.removedJudges.map(cleanText).filter(Boolean) : [],
    resultsPublic: value.resultsPublic === true,
    photoVersion: value.photoVersion != null && Number.isInteger(Number(value.photoVersion)) ? Number(value.photoVersion) : null,
  };
}

function buildSafeResponse(competition, scorecardRecords) {
  const removed = new Set(competition.removedJudges);
  const newestByJudge = new Map();

  for (const record of scorecardRecords) {
    if (field(record, "configKey") !== `compCard:${competition.code}`) continue;
    const creator = cleanText(record.created?.userRecordName);
    if (!creator || removed.has(creator)) continue;

    const card = parseJSON(field(record, "homeURL"));
    if (!isObject(card) || !isObject(card.entries)) continue;
    const judgeAccountID = cleanText(card.judgeAccountID);
    if (removed.has(judgeAccountID)) continue;
    if (card.isTest === true && (creator !== competition.creator || !judgeAccountID)) continue;
    const key = card.isTest === true ? `${creator}|${judgeAccountID}` : creator;

    const updatedAt = timestamp(card.updatedAt, record.modified?.timestamp);
    const current = newestByJudge.get(key);
    if (!current || updatedAt > current.updatedAt) {
      newestByJudge.set(key, { card, updatedAt });
    }
  }

  const cards = [...newestByJudge.values()].map(value => value.card);
  const judgeCount = cards.length;
  const namesPublic = competition.blind === false || competition.revealed === true;
  const criteria = competition.criteria.map(criterion => ({
    id: cleanText(criterion?.id),
    name: cleanText(criterion?.name) || cleanText(criterion?.id),
    weight: finiteNumber(criterion?.weight),
  })).filter(criterion => criterion.id && criterion.weight > 0);
  const checklist = competition.checklist;
  const checklistWeight = checklist.length > 0 ? competition.checklistWeight : 0;
  const checklistItems = new Set(checklist);

  // The internal number remains the scorecard key. Assign display numbers within
  // each category, preserving explicitly supplied category numbers.
  const orderedRawEntries = [...competition.entries].sort((a, b) =>
    compareEntryNumbers(normalizeEntryNumber(a?.number), normalizeEntryNumber(b?.number))
  );
  const nextByCategory = new Map();
  for (const rawEntry of orderedRawEntries) {
    const category = cleanText(rawEntry?.category) || "Entry";
    const catNumber = Number(rawEntry?.catNumber);
    if (Number.isInteger(catNumber) && catNumber > 0) {
      nextByCategory.set(category, Math.max(nextByCategory.get(category) || 0, catNumber));
    }
  }
  const displayNumbers = new Map();
  for (const rawEntry of orderedRawEntries) {
    const category = cleanText(rawEntry?.category) || "Entry";
    const supplied = Number(rawEntry?.catNumber);
    if (Number.isInteger(supplied) && supplied > 0) {
      displayNumbers.set(rawEntry, supplied);
    } else {
      const next = (nextByCategory.get(category) || 0) + 1;
      nextByCategory.set(category, next);
      displayNumbers.set(rawEntry, next);
    }
  }

  let submitted = 0;
  const entries = competition.entries.map(rawEntry => {
    const number = normalizeEntryNumber(rawEntry?.number);
    let scoredBy = 0;
    const scoresByCriterion = new Map(criteria.map(criterion => [criterion.id, []]));
    const checklistScores = [];
    const checklistCounts = new Map(checklist.map(item => [item, 0]));

    for (const card of cards) {
      const scoredEntry = card.entries?.[String(number)];
      if (!isObject(scoredEntry)) continue;
      if (entryHasSubmission(scoredEntry)) {
        scoredBy += 1;
        submitted += 1;
        const selected = new Set(Array.isArray(scoredEntry.checks) ? scoredEntry.checks : []);
        for (const item of checklistCounts.keys()) {
          if (selected.has(item)) checklistCounts.set(item, checklistCounts.get(item) + 1);
        }
      }
      if (!isObject(scoredEntry.scores)) continue;
      let hasCriterionScore = false;
      for (const criterion of criteria) {
        const score = finiteNumber(scoredEntry.scores[criterion.id]);
        if (score >= 1 && score <= 10) {
          scoresByCriterion.get(criterion.id).push(score);
          hasCriterionScore = true;
        }
      }
      if (checklistWeight > 0 && hasCriterionScore) {
        const selected = new Set(Array.isArray(scoredEntry.checks) ? scoredEntry.checks : []);
        const matched = [...selected].filter(item => checklistItems.has(item)).length;
        checklistScores.push(1 + 9 * matched / checklist.length);
      }
    }

    let weightedTotal = 0;
    let usedWeight = 0;
    const criterionResults = [];
    for (const criterion of criteria) {
      const values = scoresByCriterion.get(criterion.id);
      if (!values.length) continue;
      const average = values.reduce((sum, score) => sum + score, 0) / values.length;
      criterionResults.push({ name: criterion.name, average: round(average, 2), judgeCount: values.length });
      weightedTotal += average * criterion.weight;
      usedWeight += criterion.weight;
    }
    if (checklistWeight > 0 && usedWeight > 0 && checklistScores.length > 0) {
      const checklistAverage = checklistScores.reduce((sum, score) => sum + score, 0) / checklistScores.length;
      weightedTotal += checklistAverage * checklistWeight;
      usedWeight += checklistWeight;
    }

    const entry = {
      number,
      category: cleanText(rawEntry?.category) || "Entry",
      catNumber: displayNumbers.get(rawEntry),
      scoredBy,
      judgeCount,
    };
    if (namesPublic) entry.name = publicEntryName(rawEntry);
    if (!competition.judgingOpen) {
      entry.total = usedWeight > 0 ? round(weightedTotal / usedWeight, 4) : null;
      entry.criteria = criterionResults;
      entry.checklist = checklist.map(item => ({
        name: cleanText(item),
        percent: scoredBy > 0 ? round(100 * checklistCounts.get(item) / scoredBy, 1) : 0,
        checkedBy: checklistCounts.get(item),
        judgeCount: scoredBy,
      }));
    }
    return entry;
  });

  if (!competition.judgingOpen) {
    entries.sort((a, b) => {
      const aHasScore = typeof a.total === "number";
      const bHasScore = typeof b.total === "number";
      if (aHasScore !== bHasScore) return aHasScore ? -1 : 1;
      if (aHasScore && bHasScore && b.total !== a.total) return b.total - a.total;
      return compareEntryNumbers(a.number, b.number);
    });
  } else {
    entries.sort((a, b) => compareEntryNumbers(a.number, b.number));
  }

  return {
    title: competition.title,
    hostName: competition.hostName,
    hostDisplayName: competition.hostDisplayName,
    judgingOpen: competition.judgingOpen,
    judgingEndsAt: competition.judgingEndsAt,
    namesPublic,
    judgeCount,
    entries,
    progress: {
      submitted,
      possible: judgeCount * entries.length,
    },
    hasPhoto: competition.photoVersion !== null,
  };
}

async function photoResponse(env, competition, code, cors) {
  if (competition.photoVersion === null) {
    return new Response(null, { status: 404, headers: { ...cors, "Cache-Control": "public, max-age=15" } });
  }

  const record = await lookupRecord(env, `competitionPhoto-${code}`, ["configKey", "homeURL"]);
  const base64 = cleanText(field(record, "homeURL")).replace(/^data:image\/jpeg;base64,/i, "").replace(/\s/g, "");
  if (!base64 || base64.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return new Response(null, { status: 404, headers: { ...cors, "Cache-Control": "public, max-age=15" } });
  }

  let bytes;
  try {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return new Response(null, { status: 404, headers: { ...cors, "Cache-Control": "public, max-age=15" } });
  }

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return new Response(null, { status: 404, headers: { ...cors, "Cache-Control": "public, max-age=15" } });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=15",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function entryHasSubmission(entry) {
  const hasScores = isObject(entry.scores) && Object.keys(entry.scores).length > 0;
  const hasChecks = Array.isArray(entry.checks) && entry.checks.length > 0;
  const hasNotes = cleanText(entry.notes).length > 0;
  return hasScores || hasChecks || hasNotes;
}

function publicEntryName(entry) {
  const strain = cleanText(entry?.strain);
  const brand = cleanText(entry?.brand);
  if (strain && brand) return `${strain} · ${brand}`;
  return strain || brand || "";
}

function normalizeEntryNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : cleanText(value);
}

function compareEntryNumbers(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function timestamp(primary, fallback) {
  const parsed = Date.parse(primary);
  if (Number.isFinite(parsed)) return parsed;
  const fallbackNumber = Number(fallback);
  if (!Number.isFinite(fallbackNumber)) return 0;
  return fallbackNumber < 100_000_000_000 ? fallbackNumber * 1000 : fallbackNumber;
}

function field(record, name) {
  return record?.fields?.[name]?.value;
}

function parseJSON(value) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function json(body, status, headers, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const randomToken = bytes => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const bearer = request => (request.headers.get("Authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{30,100})$/)?.[1] || "";

const presenterCors = cors => ({ ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type", "Access-Control-Max-Age": "600" });
const noStore = (body, status = 200, cors = {}) => json(body, status, cors, "no-store");
const doStub = (env, code) => env.COMPETITION_STATE.get(env.COMPETITION_STATE.idFromName(code));
async function getCeremonyState(env, code) {
  if (!env.COMPETITION_STATE) throw new Error("Missing COMPETITION_STATE binding");
  const response = await doStub(env, code).fetch("https://internal/state");
  if (!response.ok) throw new Error("Ceremony state unavailable");
  return response.json();
}
async function presenterRoute(request, env, cors) {
  const headers = presenterCors(cors);
  if (!env.COMPETITION_STATE) return noStore({ error: "configuration" }, 500, headers);
  const url = new URL(request.url);
  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); } catch { return noStore({ error: "invalidBody" }, 400, headers); }
  }
  const requestId = request.method === "POST" ? body.requestId : url.searchParams.get("requestId");
  const code = cleanText(body.code || url.searchParams.get("code")).toUpperCase();
  if (!CODE_PATTERN.test(code)) return noStore({ error: "invalidCode" }, 400, headers);
  if (url.pathname === "/presenter/pair" && request.method === "POST") {
    const record = await lookupRecord(env, `competition-${code}`, ["configKey", "homeURL"]);
    if (!parseCompetition(record, code)) return noStore({ error: "notFound" }, 404, headers);
  }
  const forwarded = new Request(request.url, { method: request.method, headers: request.headers, body: request.method === "POST" ? JSON.stringify(body) : undefined });
  const result = await doStub(env, code).fetch(forwarded);
  const responseHeaders = new Headers(result.headers);
  for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(result.body, { status: result.status, headers: responseHeaders });
}

export class CompetitionState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "internal" && url.pathname === "/state") {
      return noStore({
        ceremonyDone: await this.state.storage.get("done") || false,
        revealed: await this.state.storage.get("revealed") || [],
        names: await this.state.storage.get("names") || {},
      });
    }
    const path = url.pathname;
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const code = cleanText(body.code || url.searchParams.get("code")).toUpperCase();
    const err = (name, status = 400) => noStore({ error: name }, status);
    if (!CODE_PATTERN.test(code)) return err("invalidCode");
    const now = Date.now();
    const requestId = body.requestId || url.searchParams.get("requestId");
    if (path === "/presenter/pair" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const hourly = (await this.state.storage.get("rate:" + ip) || []).filter(t => now - t < 3600000);
      const requests = await this.state.storage.list({ prefix: "request:" });
      const pending = [...requests.values()].filter(item => item.ip === ip && item.status === "pending" && item.expiresAt > now).length;
      if (hourly.length >= 20 || pending >= 3) return err("rateLimited", 429);
      let pairCode;
      do { pairCode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
      while ([...requests.values()].some(item => item.pairCode === pairCode && item.status === "pending" && item.expiresAt > now));
      const id = randomToken(16);
      const pollToken = randomToken(32);
      const entry = { id, code, pairCode, pollHash: await digest(pollToken), ip, status: "pending", createdAt: now, expiresAt: now + 600000, device: (request.headers.get("User-Agent") || "Computer").slice(0, 100) };
      await this.state.storage.put("request:" + id, entry);
      await this.state.storage.put("rate:" + ip, [...hourly, now]);
      return noStore({ requestId: id, pairCode, pollToken, expiresAt: new Date(entry.expiresAt).toISOString() });
    }
    if (path === "/presenter/pending" && request.method === "GET") {
      const pair = url.searchParams.get("pair");
      const failures = (await this.state.storage.get("failed") || []).filter(t => now - t < 600000);
      if (failures.length >= 10) return err("rateLimited", 429);
      const requests = await this.state.storage.list({ prefix: "request:" });
      const entry = [...requests.values()].find(item => item.pairCode === pair && item.status === "pending" && item.expiresAt > now);
      if (!entry) { await this.state.storage.put("failed", [...failures, now]); return err("notFound", 404); }
      const record = await lookupRecord(this.env, `competition-${code}`, ["configKey", "homeURL"]);
      const competition = parseCompetition(record, code);
      if (!competition) return err("notFound", 404);
      return noStore({ requestId: entry.id, code, title: competition.title, device: entry.device, createdAt: new Date(entry.createdAt).toISOString(), expiresAt: new Date(entry.expiresAt).toISOString() });
    }
    if ((path === "/presenter/approve" && request.method === "POST") || (path === "/presenter/status" && request.method === "GET")) {
      const entry = await this.state.storage.get("request:" + requestId);
      if (!entry || entry.code !== code) return err("notFound", 404);
      if (path.endsWith("/status") && await digest(bearer(request)) !== entry.pollHash) return err("unauthorized", 401);
      if (entry.expiresAt <= now) return path.endsWith("/approve") ? err("expired") : noStore({ status: "expired" });
      if (entry.status === "claimed") {
        if (path.endsWith("/approve") && body.names != null) {
          const approval = await lookupRecord(this.env, entry.approvalName, ["configKey", "homeURL"]);
          const record = await lookupRecord(this.env, `competition-${code}`, ["configKey", "homeURL"]);
          const comp = parseCompetition(record, code);
          const approved = parseJSON(field(approval, "homeURL"));
          if (!comp?.creator || approval?.created?.userRecordName !== comp.creator || approved?.requestId !== requestId || approved?.code !== code) return err("notHost", 403);
          if (typeof body.names !== "string" || typeof body.namesNonce !== "string" || !/^[0-9a-f]{64}$/.test(approved.namesDigest || "") || await digest(body.namesNonce + body.names) !== approved.namesDigest) return err("invalidNames", 403);
          const parsed = parseJSON(body.names);
          if (!isObject(parsed)) return err("invalidNames", 403);
          const clean = {};
          for (const [number, value] of Object.entries(parsed)) {
            if (!/^\d{1,5}$/.test(number) || !isObject(value)) return err("invalidNames", 403);
            clean[number] = { strain: cleanText(value.strain).slice(0, 200), brand: cleanText(value.brand).slice(0, 200) };
          }
          await this.state.storage.put("names", clean);
        }
        return path.endsWith("/approve") ? noStore({ status: "approved" }) : noStore({ status: "claimed" });
      }
      if (entry.status === "pending") {
        const approval = await lookupRecord(this.env, "presenterApproval-" + requestId, ["configKey", "homeURL"]);
        if (!approval) return path.endsWith("/approve") ? err("approvalNotFound", 409) : noStore({ status: "pending", expiresAt: new Date(entry.expiresAt).toISOString() });
        const record = await lookupRecord(this.env, `competition-${code}`, ["configKey", "homeURL"]);
        const comp = parseCompetition(record, code);
        const approved = parseJSON(field(approval, "homeURL"));
        const created = timestamp(approval.created?.timestamp, approval.created?.timestamp);
        if (!comp || !comp.creator || approval.created?.userRecordName !== comp.creator) return err("notHost", 403);
        if (field(approval, "configKey") !== "presenterApproval:" + code || approved?.requestId !== requestId || approved?.code !== code || created < entry.createdAt || now - created > 600000) return err("invalidApproval", 403);
        if (path.endsWith("/approve") && body.names != null) {
          if (typeof body.names !== "string" || typeof body.namesNonce !== "string" || !/^[0-9a-f]{64}$/.test(approved.namesDigest || "") || await digest(body.namesNonce + body.names) !== approved.namesDigest) return err("invalidNames", 403);
          const parsed = parseJSON(body.names);
          if (!isObject(parsed)) return err("invalidNames", 403);
          const clean = {};
          for (const [number, value] of Object.entries(parsed)) {
            if (!/^\d{1,5}$/.test(number) || !isObject(value)) return err("invalidNames", 403);
            clean[number] = { strain: cleanText(value.strain).slice(0, 200), brand: cleanText(value.brand).slice(0, 200) };
          }
          await this.state.storage.put("names", clean);
        }
        entry.status = "approved";
        entry.approvalName = "presenterApproval-" + requestId;
        await this.state.storage.put("request:" + requestId, entry);
      }
      if (path.endsWith("/approve")) return noStore({ status: "approved" });
      const token = randomToken(32);
      const hash = await digest(token);
      const expiresAt = now + 8 * 3600000;
      const claimed = await this.state.storage.transaction(async tx => {
        const current = await tx.get("request:" + requestId);
        if (current?.status !== "approved") return false;
        current.status = "claimed";
        await tx.put("request:" + requestId, current);
        await tx.put("session:" + hash, { approvalName: current.approvalName, expiresAt, lastCheck: now });
        return true;
      });
      return claimed ? noStore({ status: "approved", sessionToken: token, expiresAt: new Date(expiresAt).toISOString() }) : noStore({ status: "claimed" });
    }
    if (path === "/presenter/revoke" && request.method === "POST") {
      const sessions = await this.state.storage.list({ prefix: "session:" });
      for (const [key, value] of sessions) if (!await lookupRecord(this.env, value.approvalName, ["configKey"])) await this.state.storage.delete(key);
      return noStore({ status: "checked" });
    }
    const token = bearer(request);
    if (!token) return err("sessionEnded", 401);
    const hash = await digest(token);
    const session = await this.state.storage.get("session:" + hash);
    if (!session || session.expiresAt <= now) return err("sessionEnded", 401);
    if (now - session.lastCheck >= 300000) {
      const approval = await lookupRecord(this.env, session.approvalName, ["configKey"]);
      if (!approval) { await this.state.storage.delete("session:" + hash); return err("sessionEnded", 401); }
      session.lastCheck = now;
      await this.state.storage.put("session:" + hash, session);
    }
    if (path === "/presenter/logout" && request.method === "POST") { await this.state.storage.delete("session:" + hash); return noStore({ status: "loggedOut" }); }
    if (path === "/presenter/state" && request.method === "GET") {
      const record = await lookupRecord(this.env, `competition-${code}`, ["configKey", "homeURL"]);
      const comp = parseCompetition(record, code);
      if (!comp) return err("notFound", 404);
      const cards = await queryScorecards(this.env, code);
      const output = buildSafeResponse(comp, cards);
      const names = await this.state.storage.get("names") || {};
      for (const entry of output.entries) {
        if (!entry.name && names[String(entry.number)]) entry.name = [names[String(entry.number)].strain, names[String(entry.number)].brand].filter(Boolean).join(" · ");
      }
      if (Object.keys(names).length) output.namesPublic = true;
      output.presenter = { ceremonyDone: await this.state.storage.get("done") || comp.resultsPublic, revealed: await this.state.storage.get("revealed") || [] };
      output.expiresAt = new Date(session.expiresAt).toISOString();
      return noStore(output);
    }
    if (path === "/presenter/reveal" || path === "/presenter/unreveal" || path === "/presenter/finish") {
      if (request.method !== "POST") return err("method", 405);
      if (path.endsWith("/finish")) { await this.state.storage.put("done", true); return noStore({ ceremonyDone: true, revealed: await this.state.storage.get("revealed") || [] }); }
      const category = cleanText(body.category);
      const place = Number(body.place);
      if (!category || ![1, 2, 3].includes(place)) return err("invalidAward");
      const record = await lookupRecord(this.env, `competition-${code}`, ["configKey", "homeURL"]);
      const comp = parseCompetition(record, code);
      if (!comp || comp.judgingOpen) return err("judgingOpen", 409);
      const cards = await queryScorecards(this.env, code);
      const ranked = buildSafeResponse(comp, cards).entries.filter(item => item.category === category && typeof item.total === "number");
      const entry = ranked.find((item, index) => 1 + ranked.slice(0, index).filter(other => other.total > item.total).length === place);
      if (!entry) return err("notFound", 404);
      const revealed = await this.state.storage.get("revealed") || [];
      const filtered = revealed.filter(item => !(item.category === category && item.place === place));
      if (path.endsWith("/reveal")) {
        const existing = revealed.find(item => item.category === category && item.place === place);
        filtered.push(existing || { category, place, number: entry.number, at: new Date(now).toISOString() });
      }
      await this.state.storage.put("revealed", filtered);
      return noStore({ ceremonyDone: false, revealed: filtered });
    }
    return err("notFound", 404);
  }
}
