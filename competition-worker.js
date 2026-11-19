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
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: "method" }, 405, cors, "no-store");
    }

    const url = new URL(request.url);
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

      const scorecardRecords = await queryScorecards(env, code);
      const output = buildSafeResponse(competition, scorecardRecords);
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

  return {
    code: requestedCode,
    title: cleanText(value.title) || `Competition ${requestedCode}`,
    hostName: cleanText(value.hostName),
    hostDisplayName: cleanText(value.hostDisplayName),
    creator: cleanText(record.created?.userRecordName),
    blind: value.blind === true,
    revealed: value.revealed === true,
    judgingOpen: value.judgingOpen === true,
    criteria: Array.isArray(value.criteria) ? value.criteria : [],
    checklist: Array.isArray(value.checklist) ? value.checklist : [],
    checklistWeight: typeof value.checklistWeight === "number" && Number.isFinite(value.checklistWeight) && value.checklistWeight > 0 ? value.checklistWeight : 0,
    entries: Array.isArray(value.entries) ? value.entries : [],
    removedJudges: Array.isArray(value.removedJudges) ? value.removedJudges.map(cleanText).filter(Boolean) : [],
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
    weight: finiteNumber(criterion?.weight),
  })).filter(criterion => criterion.id && criterion.weight > 0);
  const checklist = competition.checklist;
  const checklistWeight = checklist.length > 0 ? competition.checklistWeight : 0;
  const checklistItems = new Set(checklist);

  let submitted = 0;
  const entries = competition.entries.map(rawEntry => {
    const number = normalizeEntryNumber(rawEntry?.number);
    let scoredBy = 0;
    const scoresByCriterion = new Map(criteria.map(criterion => [criterion.id, []]));
    const checklistScores = [];

    for (const card of cards) {
      const scoredEntry = card.entries?.[String(number)];
      if (!isObject(scoredEntry)) continue;
      if (entryHasSubmission(scoredEntry)) {
        scoredBy += 1;
        submitted += 1;
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
    for (const criterion of criteria) {
      const values = scoresByCriterion.get(criterion.id);
      if (!values.length) continue;
      const average = values.reduce((sum, score) => sum + score, 0) / values.length;
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
      scoredBy,
      judgeCount,
    };
    if (namesPublic) entry.name = publicEntryName(rawEntry);
    if (!competition.judgingOpen) entry.total = usedWeight > 0 ? round(weightedTotal / usedWeight, 4) : null;
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
