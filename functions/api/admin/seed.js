/* ===================================================================
   POST /api/admin/seed  — create + seed the D1 schema.
   Guarded by _middleware.js (KERNEL_TOKEN). Idempotent (drops + recreates).
   Alternative to pasting schema.sql in the D1 console.
   =================================================================== */

export const STMTS = [
  'DROP TABLE IF EXISTS projects',
  'DROP TABLE IF EXISTS experience',
  'DROP TABLE IF EXISTS skills',
  'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, stack TEXT NOT NULL, year INTEGER, impact TEXT, url TEXT)',
  'CREATE TABLE experience (id INTEGER PRIMARY KEY, role TEXT NOT NULL, org TEXT NOT NULL, start_year INTEGER, end_year TEXT, summary TEXT)',
  'CREATE TABLE skills (id INTEGER PRIMARY KEY, area TEXT NOT NULL, name TEXT NOT NULL, level INTEGER)',
  "INSERT INTO projects (id,name,stack,year,impact,url) VALUES (1,'HERMIT-OS','TypeScript, Three.js, GLSL, Cloudflare Pages/Functions/D1/KV',2026,'This site: a living OS-as-resume with real chaos engineering and real edge SQL','https://hermit-os.pages.dev')",
  "INSERT INTO projects (id,name,stack,year,impact,url) VALUES (2,'eBPF latency archaeology toolkit','Go, eBPF, bpftrace, perf',2025,'Localized tail latency across scheduler, page cache and network stack','')",
  "INSERT INTO projects (id,name,stack,year,impact,url) VALUES (3,'Multi-cluster Kubernetes platform','Go, Kubernetes, ArgoCD, Terraform',2024,'Self-service golden paths; resilience as an SLO-driven control loop','')",
  "INSERT INTO projects (id,name,stack,year,impact,url) VALUES (4,'Chaos engineering control plane','Rust, Kubernetes, Chaos Mesh',2024,'Hypothesis-driven failure injection with automated rollback gates','')",
  "INSERT INTO projects (id,name,stack,year,impact,url) VALUES (5,'Edge RAG + agent runtime','Python, TypeScript, Workers AI, pgvector',2025,'RAG agents with bounded autonomy and eval harnesses','')",
  "INSERT INTO experience (id,role,org,start_year,end_year,summary) VALUES (1,'Staff Systems Engineer','Distributed Platforms',2022,'present','Owned multi-cluster K8s platform, SRE practice, chaos engineering program')",
  "INSERT INTO experience (id,role,org,start_year,end_year,summary) VALUES (2,'Senior SRE','High-traffic Edge',2019,'2022','SLO/error-budget engineering, eBPF observability, incident command')",
  "INSERT INTO experience (id,role,org,start_year,end_year,summary) VALUES (3,'Linux Systems Engineer','Infrastructure',2016,'2019','Kernel-adjacent tooling, namespaces/cgroups, networking, automation at scale')",
  "INSERT INTO skills (id,area,name,level) VALUES (1,'devops','Kubernetes',5)",
  "INSERT INTO skills (id,area,name,level) VALUES (2,'devops','Chaos Engineering',5)",
  "INSERT INTO skills (id,area,name,level) VALUES (3,'devops','Terraform / IaC',4)",
  "INSERT INTO skills (id,area,name,level) VALUES (4,'devops','Observability / SRE',5)",
  "INSERT INTO skills (id,area,name,level) VALUES (5,'linux','Kernel internals',5)",
  "INSERT INTO skills (id,area,name,level) VALUES (6,'linux','eBPF / tracing',5)",
  "INSERT INTO skills (id,area,name,level) VALUES (7,'linux','Networking',4)",
  "INSERT INTO skills (id,area,name,level) VALUES (8,'development','Go',4)",
  "INSERT INTO skills (id,area,name,level) VALUES (9,'development','Rust',4)",
  "INSERT INTO skills (id,area,name,level) VALUES (10,'development','Python',5)",
  "INSERT INTO skills (id,area,name,level) VALUES (11,'development','TypeScript',4)",
  "INSERT INTO skills (id,area,name,level) VALUES (12,'ai','Applied ML / RAG',4)",
  "INSERT INTO skills (id,area,name,level) VALUES (13,'ai','Agentic systems',4)",
];

export async function onRequestPost({ env }) {
  if (!env.HERMIT_DB) return json({ ok: false, error: 'D1 not bound (HERMIT_DB).' }, 503);
  try {
    await env.HERMIT_DB.batch(STMTS.map(s => env.HERMIT_DB.prepare(s)));
    const counts = {};
    for (const t of ['projects', 'experience', 'skills']) {
      const r = await env.HERMIT_DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      counts[t] = r ? r.n : 0;
    }
    return json({ ok: true, seeded: counts });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
