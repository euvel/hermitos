-- ===================================================================
-- HERMIT-OS — Cloudflare D1 schema + seed
-- Paste this into:  Dashboard → Workers & Pages → D1 → (your db) → Console
-- (or run via the guarded POST /api/admin/seed endpoint).
-- Edit the seed rows to your real history, or use kernel-mode later.
-- ===================================================================

DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS experience;
DROP TABLE IF EXISTS skills;

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  stack TEXT NOT NULL,
  year INTEGER,
  impact TEXT,
  url TEXT
);

CREATE TABLE experience (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  org TEXT NOT NULL,
  start_year INTEGER,
  end_year TEXT,
  summary TEXT
);

CREATE TABLE skills (
  id INTEGER PRIMARY KEY,
  area TEXT NOT NULL,
  name TEXT NOT NULL,
  level INTEGER
);

INSERT INTO projects (id, name, stack, year, impact, url) VALUES
  (1, 'HERMIT-OS', 'TypeScript, Three.js, GLSL, Cloudflare Pages/Functions/D1/KV', 2026, 'This site: a living OS-as-resume with real chaos engineering and real edge SQL', 'https://hermit-os.pages.dev'),
  (2, 'eBPF latency archaeology toolkit', 'Go, eBPF, bpftrace, perf', 2025, 'Localized tail latency across scheduler, page cache and network stack at fleet scale', ''),
  (3, 'Multi-cluster Kubernetes platform', 'Go, Kubernetes, ArgoCD, Terraform', 2024, 'Self-service golden paths; turned resilience into an SLO-driven control loop', ''),
  (4, 'Chaos engineering control plane', 'Rust, Kubernetes, Chaos Mesh', 2024, 'Hypothesis-driven failure injection with automated rollback gates', ''),
  (5, 'Edge RAG + agent runtime', 'Python, TypeScript, Workers AI, pgvector', 2025, 'Retrieval-augmented agents with bounded autonomy and eval harnesses', '');

INSERT INTO experience (id, role, org, start_year, end_year, summary) VALUES
  (1, 'Staff Systems Engineer', 'Distributed Platforms', 2022, 'present', 'Owned multi-cluster K8s platform, SRE practice, and chaos engineering program'),
  (2, 'Senior SRE', 'High-traffic Edge', 2019, 2022, 'SLO/error-budget engineering, eBPF observability, incident command'),
  (3, 'Linux Systems Engineer', 'Infrastructure', 2016, 2019, 'Kernel-adjacent tooling, namespaces/cgroups, networking, automation at scale');

INSERT INTO skills (id, area, name, level) VALUES
  (1, 'devops', 'Kubernetes', 5),
  (2, 'devops', 'Chaos Engineering', 5),
  (3, 'devops', 'Terraform / IaC', 4),
  (4, 'devops', 'Observability / SRE', 5),
  (5, 'linux', 'Kernel internals', 5),
  (6, 'linux', 'eBPF / tracing', 5),
  (7, 'linux', 'Networking', 4),
  (8, 'development', 'Go', 4),
  (9, 'development', 'Rust', 4),
  (10, 'development', 'Python', 5),
  (11, 'development', 'TypeScript', 4),
  (12, 'ai', 'Applied ML / RAG', 4),
  (13, 'ai', 'Agentic systems', 4);
