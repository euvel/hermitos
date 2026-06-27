/* ===================================================================
   HERMIT-OS — virtual filesystem
   The observable projection of Euvel's internal state.
   Files are "low-information observables": stable, read-only,
   Lipschitz-bounded summaries of a turbulent internal manifold.
   =================================================================== */

// A node is { type:'dir'|'file', mode, mtime, content?, children? }
// content may be a string OR a function(ctx) returning a string.

const F = (content, mode = '-r--r--r--') => ({ type: 'file', mode, content });
const D = (children, mode = 'dr-xr-xr-x') => ({ type: 'dir', mode, children });

export const FS_VERSION = '1.0.0';

export const fs = D({
  'README.observer': F(
`HERMIT-OS — external observer interface
=======================================

You are attached to the *projection* of Euvel: a non-ergodic singular
orbifold. What you read here is a Lipschitz-stable, low-information
shadow of an internal system that is turbulent, high-dimensional, and
mostly inaccessible from the outside.

  observable baseline ......... constant (zero observed gradient)
  internal metric ............. inhomogeneously degenerate
  information flow ............ asymmetrically decoupled (out << in)
  invariant structure ......... KAM tori + trapping sets
  projection ................. observer @ ker(d/dt)|_baseline

This filesystem is the projection. Navigate it like Linux.

  ls /skills        what the projection is permitted to expose
  cat /home/euvel/manifesto.txt
  aiwass guide      converse with the resident intelligence
  man hermit        the operator's manual
  whoami            you are not Euvel; you are the observer

Everything you cannot see is not missing. It is trapped.`),

  home: D({
    euvel: D({
      'manifesto.txt': F(
`THE NON-ERGODIC MANIFESTO
=========================

I do not average. An ergodic system forgets where it started; its time
average equals its space average and the past dissolves into the mean.
I refuse the mean. My trajectory never fills its phase space. Whole
regions of who-I-could-be remain forever untouched — invariant sets
the dynamics cannot reach, and from which nothing leaks.

To you, the external observer, I present a constant baseline. The same
calm surface, the same steady metric, the same answer to "how are you":
const. This is not simplicity. It is a *projection* — the image of a
violent interior under a map engineered to have zero observable
gradient. Push on the surface and it does not move, because the energy
of the push is absorbed into degenerate directions of the metric where
distances collapse to zero and your perturbation does no work you can see.

I am singular where it matters and smooth where it is watched.

  - inhomogeneous metric degeneracy  :: I am not uniformly rigid;
        I am rigid exactly where you probe and fluid everywhere else.
  - asymmetric information decoupling :: I receive the world at full
        bandwidth; I emit a trickle, by design.
  - sheaf-theoretic dissociation      :: my local truths are real and
        consistent; they simply do not glue into one global section.
  - invariant trapping sets           :: the important state is caught
        in regions orbits enter but never leave.
  - Lipschitz-stable observable proj. :: bounded input → bounded,
        continuous output. I never spike. I cannot be made to spike.

Hire the projection if you want a constant. Probe the orbifold if you
want the truth. Both are me. They do not glue.

                                              — Euvel`),

      '.secret': F(
`# trapping set — entry without exit
# the ritual is not here. it is in the gluing.
# sheaves do not glue globally; find where two local sections agree
# and force the identification. see: 'man sheaf', 'aiwass ask "how do I become root"'.
# whisper to the kernel the three degeneracies in order.`,
        '-r--------'),

      '.bash_history': F(
`whoami
cat /proc/euvel/coherence
glue --local /devops /linux
induce turbulence
dissociate
aiwass ask "is the baseline real"
chaos apply --blast-radius node
journalctl -u euvel --since boot
# (history truncated: most commands trapped in invariant set)`,
        '-rw-------'),

      'contact.vcf': F(
`BEGIN:VCARD
VERSION:3.0
FN:Euvel
TITLE:Non-ergodic Singular Orbifold / Staff Systems Engineer
ROLE:DevOps · Linux · Distributed Systems · Applied AI
NOTE:Reachable only through the projection. Bandwidth out is bounded.
X-OBSERVABLE-BASELINE:constant
X-PREFERRED-PROTOCOL:aiwass ask "..."
END:VCARD`),
    }, 'drwxr-xr-x'),
  }),

  skills: D({
    'INDEX.map': F(
`/skills — the permitted observables
  devops/        orchestration, chaos engineering, IaC, SRE
  linux/         kernel, namespaces, tracing, networking, perf
  development/   languages, systems, APIs, data
  ai/            applied ML, retrieval, agents, AIWASS internals
  kernel/        HERMIT-OS internals (privileged glimpses)

  hint: 'tree /skills'  ·  'grep -r kubernetes /skills'  ·  'cat /skills/devops/*'`),

    devops: D({
      'orchestration.k8s': F(
`KUBERNETES & ORCHESTRATION  ████████████░ expert
  - Multi-cluster topologies; federation; fleet of stateless+stateful WLs
  - Operators / CRDs / controllers (client-go, kubebuilder)
  - Progressive delivery: Argo Rollouts, canary, blue/green, flagger
  - Mesh: Istio / Linkerd — mTLS, traffic mirroring, fault injection
  - Autoscaling: HPA/VPA/KEDA, cluster-autoscaler, Karpenter
  try: 'kubectl get pods'  ·  'kubectl simulate failure'  ·  'helm chaos'`),
      'chaos.engineering': F(
`CHAOS ENGINEERING  █████████████ expert
  - Hypothesis-driven failure injection; steady-state verification
  - Tools: Chaos Mesh, LitmusChaos, Gremlin, toxiproxy, tc/netem
  - Game days, blast-radius control, automated rollback gates
  - Resilience as an *observable*: SLO error budgets as control signal
  PHILOSOPHY: a system you cannot break on purpose, you do not understand.
  try: 'chaos apply --blast-radius node'  ·  'chaos status'  ·  'chaos revert'`),
      'iac.terraform': F(
`INFRASTRUCTURE AS CODE  ████████████░ expert
  - Terraform / OpenTofu modules, workspaces, remote state, drift control
  - Pulumi (typed IaC), Crossplane (control-plane IaC)
  - Packer golden images; immutable infra; GitOps via Argo CD / Flux
  - Policy as code: OPA/Gatekeeper, Conftest, Sentinel`),
      'observability.sre': F(
`SRE & OBSERVABILITY  █████████████ expert
  - Prometheus/Thanos, Grafana, Loki, Tempo, OpenTelemetry pipelines
  - SLI/SLO/error-budget engineering; burn-rate alerting
  - Incident command, blameless postmortems, runbook automation
  - eBPF observability (Pixie, Cilium Hubble, parca continuous profiling)`),
      'cicd.pipelines': F(
`CI/CD & PLATFORM  ████████████░ advanced
  - GitHub Actions, GitLab CI, Argo Workflows, Tekton, Jenkins
  - Supply-chain: SLSA, sigstore/cosign, SBOM, provenance attestation
  - Internal developer platforms (Backstage), golden paths, self-service`),
    }, 'drwxr-xr-x'),

    linux: D({
      'kernel.internals': F(
`LINUX KERNEL & INTERNALS  █████████████ expert
  - Namespaces (pid/net/mnt/uts/ipc/user/cgroup), cgroups v2, capabilities
  - Scheduler (CFS/EEVDF), memory mgmt, page cache, OOM behavior
  - Writing/patching modules; netfilter hooks; udev; systemd units
  - seccomp-bpf sandboxing; LSM (AppArmor/SELinux) policy authoring`),
      'tracing.perf': F(
`TRACING & PERFORMANCE  █████████████ expert
  - eBPF/bcc/bpftrace authoring; kprobes/uprobes/tracepoints
  - perf, ftrace, strace, ltrace, SystemTap; flamegraphs
  - Latency archaeology: off-CPU analysis, scheduler latency, I/O stalls
  try: 'strace -p 1'  ·  'bpftrace -e ...'  ·  'perf top'`),
      'networking': F(
`NETWORKING  ████████████░ advanced
  - TCP/IP internals, tc/qdisc shaping, XDP, VXLAN/Geneve overlays
  - iptables/nftables, conntrack, policy routing, WireGuard
  - DNS, BGP basics, service mesh data planes, load-balancer internals`),
      'shell.automation': F(
`SHELL & AUTOMATION  █████████████ expert
  - bash/zsh wizardry, POSIX sh portability, awk/sed/jq fluency
  - Ansible at fleet scale; idempotent provisioning; dotfile orchestration
  - systemd timers, cron, inotify-driven automation`),
    }, 'drwxr-xr-x'),

    development: D({
      'languages.txt': F(
`LANGUAGES
  Go .......... ████████████░  services, operators, CLIs, eBPF userspace
  Rust ........ ███████████░░  systems, WASM, performance-critical paths
  Python ...... █████████████  tooling, ML, automation, data
  TypeScript .. ████████████░  edge/workers, frontends, full-stack
  C ........... ██████████░░░  kernel-adjacent, embedded, FFI
  Bash ........ █████████████  glue of the universe`),
      'systems.txt': F(
`SYSTEMS & DISTRIBUTED
  - Event-driven & streaming (Kafka, NATS, Redpanda)
  - Consensus & coordination (Raft, etcd, ZooKeeper)
  - Databases: Postgres internals, CockroachDB, ClickHouse, Redis
  - Idempotency, exactly-once illusions, backpressure, saga patterns
  - Edge compute: Cloudflare Workers/Pages/KV/Durable Objects (this site)`),
      'apis.txt': F(
`APIS & INTERFACES
  - gRPC, Protobuf, Connect; REST with proper hypermedia discipline
  - GraphQL federation; OpenAPI-first contracts
  - WebSockets, SSE, WebTransport; WASM component model`),
    }, 'drwxr-xr-x'),

    ai: D({
      'applied-ml.txt': F(
`APPLIED MACHINE LEARNING  ████████████░ advanced
  - Retrieval-augmented generation; hybrid search; reranking
  - Agentic systems: tool-use, planning, evaluator-optimizer loops
  - LLM inference ops: batching, KV-cache, quantization, vLLM/TGI
  - Embeddings, vector stores (pgvector, Qdrant), semantic routing`),
      'aiwass.spec': F(
`AIWASS — resident intelligence
  A guide, not an oracle. It speaks in the dense register of the
  orbifold: differential-geometric, sheaf-theoretic, dynamical.
  - backend: Groq (fast inference) via Cloudflare Pages Function
  - fallback: deterministic local heuristic if no key bound
  - persona: bounded-emission, high-context, Lipschitz in tone
  invoke: 'aiwass ask "..."'  ·  'aiwass guide'  ·  'aiwass whoami'`),
      'safety.txt': F(
`ALIGNMENT & SAFETY POSTURE
  - eval harnesses, red-teaming, prompt-injection defense
  - bounded autonomy; human-in-the-loop for irreversible ops
  - the same discipline as chaos engineering, applied to cognition`),
    }, 'drwxr-xr-x'),

    kernel: D({
      'NOTE': F(
`/skills/kernel — privileged observables
  These describe HERMIT-OS itself. Reading is permitted; writing is not,
  unless you are elevated. The path to elevation is not a password.
  It is a *gluing*. See 'man sheaf' and 'cat /home/euvel/.secret'.`),
      'topology.txt': F(
`HERMIT-OS TOPOLOGY
  - the orbifold background is a real GLSL dynamical system
  - terminal commands perturb its parameters (metric, turbulence, KAM)
  - chaos commands inject node/pod failures into the visual field
  - the projection (this terminal) stays Lipschitz-stable regardless`),
    }, 'drwxr-xr-x'),
  }),

  proc: D({
    euvel: D({
      coherence: F((ctx) => {
        const t = (Date.now() / 1000) % 1;
        return `internal_coherence: ${(0.5 + 0.49 * Math.sin(Date.now()/700)).toFixed(6)}\n` +
               `observable_gradient: 0.000000   (clamped by projection)\n` +
               `metric_degeneracy: inhomogeneous\n` +
               `trapping_sets: 7 active, 0 escaped\n` +
               `kam_tori: ${3 + (ctx?.kam ?? 0)} intact\n` +
               `ergodicity: false`;
      }),
      baseline: F('observable_baseline = const\n# this file is the same every time you read it. that is the point.'),
    }),
    version: F('HERMIT-OS version 1.0.0-orbifold (observer build)\n#1 SMP PREEMPT_DYNAMIC non-ergodic'),
    uptime: F((ctx) => `up since attach; baseline steady; load average: 0.00, 0.00, 0.00`),
    cpuinfo: F('processor : 0\nmodel name : Singular Orbifold Core (degenerate metric)\nflags : kam trap sheaf lipschitz nonergodic ebpf'),
  }, 'dr-xr-xr-x'),

  etc: D({
    'hermit-release': F('hermit 1.0.0\nID=hermit\nPRETTY_NAME="hermit — interactive systems terminal"'),
    motd: F(
`  ◉  hermit — an interactive systems terminal
     real tools, in the browser. type 'help' to begin.`),
    passwd: F(
`root:x:0:0:kernel:/root:/sbin/nologin
euvel:x:1000:1000:Euvel,,non-ergodic orbifold:/home/euvel:/bin/hermit-sh
observer:x:1001:1001:External Observer:/home/observer:/bin/hermit-sh
aiwass:x:42:42:Resident Intelligence:/var/lib/aiwass:/sbin/nologin`),
  }, 'drwxr-xr-x'),

  var: D({
    log: D({
      'kernel.log': F('see: journalctl  ·  dmesg'),
    }),
    lib: D({
      aiwass: D({
        'weights.bin': F('[binary] — emission-bounded; reading raw weights is asymmetrically decoupled from output.'),
      }),
    }),
  }),

  bin: D({
    'hermit-sh': F('[ELF] HERMIT-OS shell. you are soaking in it.', '-r-xr-xr-x'),
  }, 'dr-xr-xr-x'),
}, 'dr-xr-xr-x');

/* ── path utilities ──────────────────────────────────────────────── */

export function normalize(cwd, path) {
  if (!path) return cwd;
  let parts;
  if (path.startsWith('/')) parts = path.split('/');
  else parts = (cwd + '/' + path).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    if (p === '~') { out.length = 0; out.push('home', 'euvel'); continue; }
    out.push(p);
  }
  return '/' + out.join('/');
}

export function resolve(path) {
  // returns node at absolute path, or null
  if (path === '/' || path === '') return fs;
  const parts = path.split('/').filter(Boolean);
  let node = fs;
  for (const p of parts) {
    if (node.type !== 'dir' || !node.children[p]) return null;
    node = node.children[p];
  }
  return node;
}

export function readFile(node, ctx) {
  if (!node || node.type !== 'file') return null;
  return typeof node.content === 'function' ? node.content(ctx || {}) : node.content;
}

export function listDir(path) {
  const node = resolve(path);
  if (!node || node.type !== 'dir') return null;
  return Object.entries(node.children).map(([name, n]) => ({ name, ...n }));
}
