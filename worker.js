// Strain Diary review-page proxy (Cloudflare Worker).
//
// Keeps the CloudKit API token secret and only ever returns one thing:
// a published review page, looked up by account id. Nothing else in the
// public database (profiles, emails, posts, messages) can be reached
// through it.
//
// Setup: Workers & Pages → Create Worker → paste this file → Deploy.
// Then Settings → Variables and Secrets → add a *Secret* named
// CK_API_TOKEN with the new CloudKit token.

const CK = "https://api.apple-cloudkit.com/database/1/iCloud.Gary.Strain-Diary-optimized/production/public/records";
const SITE = "https://straindiary.com";

export default {
  async fetch(request, env) {
    const cors = { "Access-Control-Allow-Origin": SITE, "Vary": "Origin" };
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
    if (request.method !== "GET") return reply({ error: "method" }, 405, cors);

    // Account ids are UUIDs; anything else is refused before touching CloudKit.
    const id = (new URL(request.url).searchParams.get("id") || "").trim();
    if (!/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(id)) {
      return reply({ error: "bad id" }, 400, cors);
    }

    const ck = (path, body) => fetch(`${CK}/${path}?ckAPIToken=${encodeURIComponent(env.CK_API_TOKEN)}`, {
      method: "POST",
      headers: { "Origin": SITE },
      body: JSON.stringify(body),
    }).then(r => r.json());

    try {
      const look = await ck("lookup", { records: [{ recordName: "reviewPage-" + id }] });
      const rec = look.records && look.records[0];
      const raw = rec && rec.fields && rec.fields.homeURL && rec.fields.homeURL.value;
      if (!raw || !rec.fields.configKey || rec.fields.configKey.value !== "reviewPage") {
        return reply({ page: null }, 200, cors);
      }

      // Anti-squatting: the page only counts if the same iCloud user that
      // created this account's profile created the page record. Otherwise
      // someone could pre-create "reviewPage-<your id>" and own your link.
      if (env.SKIP_OWNER_CHECK !== "1") {
        const prof = await ck("query", {
          query: { recordType: "UserProfile", filterBy: [{ fieldName: "userRecordID", comparator: "EQUALS", fieldValue: { value: id } }] },
          desiredKeys: ["userRecordID"],
          resultsLimit: 5,
        });
        const owners = (prof.records || []).map(r => r.created && r.created.userRecordName).filter(Boolean);
        const creator = rec.created && rec.created.userRecordName;
        if (!creator || !owners.includes(creator)) return reply({ page: null, unverified: true }, 200, cors);
      }

      const page = JSON.parse(raw);
      // Pass through only the page fields the site renders.
      const out = { h: page.h, n: page.n, u: page.u, tabs: page.tabs, s: page.s, g: page.g, d: page.d };
      return reply({ page: out }, 200, { ...cors, "Cache-Control": "public, max-age=60" });
    } catch (e) {
      return reply({ error: "upstream" }, 502, cors);
    }
  },
};

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
