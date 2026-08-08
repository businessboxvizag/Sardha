/**
 * loadtest.js — dependency-free load + rate-limit smoke test for the Saardha API.
 *
 * Hits only SAFE, read-only, no-auth endpoints (never creates orders or mutates data):
 *   GET /health            — liveness
 *   GET /api/config        — public config
 *
 * Then a burst test against POST /api/auth/login with junk credentials to confirm the
 * auth rate limiter kicks in (expects HTTP 429s once the window limit is exceeded —
 * that's a PASS, it means brute-force protection is working).
 *
 * USAGE:
 *   node loadtest.js [baseUrl] [concurrency] [seconds]
 *   node loadtest.js http://localhost:3000 20 10
 *   BASE_URL=https://sardha-api.onrender.com node loadtest.js
 *
 * Defaults: http://localhost:3000, concurrency 20, duration 10s.
 * Keep concurrency modest against the live free-tier host.
 */
const http = require("http");
const https = require("https");

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const CONC = Number(process.argv[3] || 20);
const SECS = Number(process.argv[4] || 10);
const lib = BASE.startsWith("https") ? https : http;

function req(method, path, body) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const r = lib.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
        headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } },
      (res) => { res.on("data", () => {}); res.on("end", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        resolve({ status: res.statusCode, ms });
      }); }
    );
    r.on("error", () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - start) / 1e6 }));
    if (data) r.write(data);
    r.end();
  });
}

function pct(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }

async function loadPhase(name, path) {
  console.log(`\n▶ ${name}  (${CONC} concurrent × ${SECS}s → GET ${path})`);
  const lat = []; const codes = {}; const deadline = Date.now() + SECS * 1000;
  let inflight = 0, total = 0;
  await new Promise((done) => {
    const tick = () => {
      if (Date.now() >= deadline && inflight === 0) return done();
      while (inflight < CONC && Date.now() < deadline) {
        inflight++;
        req("GET", path).then((r) => { inflight--; total++; lat.push(r.ms); codes[r.status] = (codes[r.status] || 0) + 1; setImmediate(tick); });
      }
    };
    tick();
  });
  const rps = (total / SECS).toFixed(1);
  console.log(`  requests: ${total}   throughput: ${rps} req/s`);
  console.log(`  latency ms — p50 ${pct(lat, 50).toFixed(1)}  p95 ${pct(lat, 95).toFixed(1)}  p99 ${pct(lat, 99).toFixed(1)}  max ${Math.max(...lat).toFixed(1)}`);
  console.log(`  status codes: ${JSON.stringify(codes)}`);
  return { total, codes };
}

async function rateLimitPhase() {
  console.log(`\n▶ Rate-limit check  (60 rapid POST /api/auth/login with junk creds)`);
  const codes = {};
  for (let i = 0; i < 60; i++) {
    const r = await req("POST", "/api/auth/login", { email: `x${i}@nope.test`, password: "wrong" });
    codes[r.status] = (codes[r.status] || 0) + 1;
  }
  console.log(`  status codes: ${JSON.stringify(codes)}`);
  if (codes["429"]) console.log(`  ✅ PASS — limiter returned ${codes["429"]}× HTTP 429 (brute-force protection active).`);
  else console.log(`  ⚠️  No 429s seen — check trust-proxy + auth limiter (or the window is larger than this burst).`);
}

(async () => {
  console.log(`Saardha load test → ${BASE}`);
  const health = await req("GET", "/health");
  if (health.status !== 200) { console.error(`\n✗ /health returned ${health.status}. Is the server up at ${BASE}? Aborting.`); process.exit(1); }
  console.log(`✓ /health OK (${health.ms.toFixed(0)}ms)`);

  await loadPhase("Health endpoint", "/health");
  await loadPhase("Public config", "/api/config");
  await rateLimitPhase();
  console.log("\nDone.\n");
  process.exit(0);
})();
