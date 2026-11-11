import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runConnectors } from "../lib/connectors/index.js";
import { parseWorks, parseAuthors, authorsUrl, worksUrl } from "../lib/connectors/openalex.js";
import { parseFilings, searchUrl } from "../lib/connectors/sec-edgar.js";
import { DEFAULT_SETTINGS, CONNECTOR_INFO } from "../lib/constants.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.SEC_CONTACT_EMAIL; });
const on = (...ids) => ({ connectors: Object.fromEntries(ids.map(i => [i, { enabled: true }])) });
const project = { p0: { venture_name: "Acme Robotics", product_service: "autonomous warehouse picking robots using vision" }, entities: { people: ["Ana Rossi", "x"] } };

test("every connector is OFF by default and documented for the Settings screen", () => {
  for (const id of Object.keys(CONNECTOR_INFO)) {
    assert.equal(DEFAULT_SETTINGS.connectors[id].enabled, false, id);
    assert.ok(CONNECTOR_INFO[id].sends && CONNECTOR_INFO[id].helps);
  }
});

test("disabled connectors make no network calls at all", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("should not be called"); };
  const out = await runConnectors({ methodId: "team_assessment", settings: DEFAULT_SETTINGS, project });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});

test("OpenAlex: parses author and work records (documented response shape) into cited evidence", () => {
  const authors = parseAuthors({ results: [{ id: "https://openalex.org/A1", display_name: "Ana Rossi", works_count: 41, cited_by_count: 900, last_known_institutions: [{ display_name: "ETH Zurich" }] }, { id: "x" }] }, "Ana Rossi");
  assert.equal(authors.length, 1);
  assert.match(authors[0].text, /ETH Zurich/);
  assert.match(authors[0].text, /identity not verified/, "name matches are never presented as confirmed");
  assert.equal(authors[0].url, "https://openalex.org/A1");
  assert.ok(authors[0].confidence < 0.5);

  const works = parseWorks({ results: [{ id: "https://openalex.org/W1", display_name: "Vision-based picking", publication_year: 2023, cited_by_count: 12, doi: "https://doi.org/10.1/x" }] }, "picking robots");
  assert.equal(works[0].url, "https://doi.org/10.1/x");
  assert.equal(works[0].published, "2023");
  assert.deepEqual(parseWorks({}, "q"), []);
  assert.deepEqual(parseAuthors(null, "q"), []);
});

test("OpenAlex: queries are URL-encoded, bounded, and identify the caller when configured", () => {
  process.env.CONNECTOR_CONTACT_EMAIL = "ops@example.com";
  const u = authorsUrl("Ana & Co <x>");
  assert.ok(u.startsWith("https://api.openalex.org/authors?search=Ana%20%26%20Co%20%3Cx%3E"));
  assert.match(u, /per-page=3/);
  assert.match(u, /mailto=ops%40example\.com/);
  assert.match(worksUrl("a b"), /per-page=5/);
  delete process.env.CONNECTOR_CONTACT_EMAIL;
});

test("SEC EDGAR: keeps only filings by an entity whose name contains the company; builds archive links", () => {
  const json = { hits: { hits: [
    { _source: { display_names: ["Acme Robotics, Inc.  (CIK 0001234567)"], ciks: ["0001234567"], file_date: "2024-05-12", form: "D", adsh: "0001234567-24-000001" } },
    { _source: { display_names: ["Totally Different Corp"], ciks: ["0009"], file_date: "2024-01-01", adsh: "0000000009-24-000002" } },
  ] } };
  const f = parseFilings(json, "Acme Robotics");
  assert.equal(f.length, 1, "unrelated filers are dropped");
  assert.match(f[0].text, /Form D .* filed 2024-05-12/);
  assert.equal(f[0].url, "https://www.sec.gov/Archives/edgar/data/1234567/000123456724000001/");
  assert.match(f[0].text, /amounts are not in this index/);
  assert.deepEqual(parseFilings({ hits: {} }, "x"), []);
  assert.match(searchUrl('Acme "Robotics"'), /forms=D/);
});

test("runConnectors: enabled connectors yield tagged, cited chunks for the right methods only", async () => {
  process.env.SEC_CONTACT_EMAIL = "ops@example.com";
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push({ url: String(url), ua: init?.headers?.["User-Agent"] });
    const body = String(url).includes("openalex")
      ? { results: [{ id: "https://openalex.org/A1", display_name: "Ana Rossi", works_count: 3, cited_by_count: 4 }] }
      : { hits: { hits: [{ _source: { display_names: ["Acme Robotics Inc"], ciks: ["1"], file_date: "2024-02-02", adsh: "1-24-1" } }] } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const team = await runConnectors({ methodId: "team_assessment", settings: on("openalex", "sec_edgar"), project });
  assert.ok(team.length > 0 && team.every(c => c.source_type === "connector" && c.retrieved_by === "openalex:team_assessment" && c.source_url));
  assert.ok(urls.every(u => u.url.includes("openalex")), "SEC is not queried for the team method");
  assert.ok(!urls.some(u => u.url.includes("%22x%22") || u.url.includes("search=x&")), "too-short names are not sent anywhere");

  urls.length = 0;
  const deal = await runConnectors({ methodId: "deal_valuation", settings: on("sec_edgar"), project });
  assert.equal(deal[0].retrieved_by, "sec_edgar:deal_valuation");
  assert.match(urls[0].ua, /ops@example\.com/, "SEC requires a contact in the User-Agent");

  assert.deepEqual(await runConnectors({ methodId: "top_down_tam", settings: on("openalex", "sec_edgar"), project }), [], "irrelevant methods use no connector");
});

test("a failing, slow or malformed connector never breaks the pipeline", async () => {
  const settings = on("openalex", "sec_edgar");
  globalThis.fetch = async () => new Response("<html>rate limited</html>", { status: 200 });
  assert.deepEqual(await runConnectors({ methodId: "team_assessment", settings, project }), []);
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  assert.deepEqual(await runConnectors({ methodId: "team_assessment", settings, project }), []);
  globalThis.fetch = async () => new Response("nope", { status: 503 });
  assert.deepEqual(await runConnectors({ methodId: "deal_valuation", settings, project }), []);
  // SEC without a contact address is skipped (not sent anonymously)
  let called = false; globalThis.fetch = async () => { called = true; return new Response("{}"); };
  assert.deepEqual(await runConnectors({ methodId: "deal_valuation", settings, project }), []);
  assert.equal(called, false);
});
