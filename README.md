# RippleTrace

**See how one policy change ripples through the enterprise.**

RippleTrace is a WebMCP-powered policy-to-execution intelligence workspace for the fictional company **Wexler Systems**. It connects requirements, controls, engineering work, architecture decisions, automated tests, evidence, exceptions, and continuous monitoring without pretending to replace their systems of record.

All people, records, integrations, identifiers, and company details in this repository are synthetic demonstration data.

## The enterprise problem

The truth required for an assurance decision is fragmented:

| Enterprise truth | Represented system of record |
| --- | --- |
| Security policy | Confluence |
| SOC 2 and ISO control matrix | Google Sheets |
| Engineering delivery | Jira and Azure Boards |
| Architecture decisions | SharePoint |
| Automated verification | GitHub Actions and Azure DevOps Pipelines |
| Corporate identity | Microsoft Entra ID |
| Acquired-business identity | Okta |
| Infrastructure | AWS, Azure, and Terraform Cloud |
| Logging and retention | Splunk and Datadog |
| Exception approvals | ServiceNow and represented email evidence |
| Continuous compliance | Vanta |

A policy edit in Confluence can invalidate a control in Sheets, a green test in GitHub Actions, a Jira acceptance criterion, or an approved ServiceNow exception. Ordinary links do not understand that semantic change.

RippleTrace maintains the chain:

```text
Policy → Requirement → Control → Work → Test → Evidence
                         ↘ Exception → Human decision
```

## Live change-room journey

The interface opens on one deeply modeled enterprise event rather than a populated dashboard:

1. **Incoming change** — Confluence event `AC2-CHG-2026-017` asks what will break if Wexler approves AC-2 v3.
2. **Agent investigation** — granular WebMCP tools inspect the policy, bounded dependency chain, exact source records, findings, and readiness calculation.
3. **Visible activity** — every WebMCP tool start, completion, and failure appears in the live investigation timeline.
4. **Impact review** — deterministic comparisons derive 14 findings, each with exact record IDs, the rule that produced it, and an evidence drawer.
5. **Human decision** — every proposal, including adopting AC-2 v3 itself, stays inert until Dana Lindqvist decides it in this UI. The agent has no tool for any of it.
6. **Governed execution** — approved proposals visibly change readiness, audit history, and downstream work state.
7. **Dependencies** — "what breaks if this changes", answered the way an engineer
   expects: pick the thing you are about to change, see what depends on it
   ordered by distance, and read every node by the identifier you would paste
   into your own tracker — `PLAT-4488`, Azure Boards `12844`, `ca-policy.yml`,
   `RITM0084412`, `WSEC/pages/884215`.
8. **Reset** — **Reset Wexler scenario** restores the original unassessed event for repeatable judging.

The right rail preserves context with a weighted readiness score, journey progress, and recent activity.

## Deterministic analysis

The agent translates policy language into structured assertions. Programs—not model prose—derive the consequences.

The prepared change requires:

- phishing-resistant authentication;
- no weak-factor fallback;
- access review every 90 days; and
- coverage for privileged humans, contractors, service principals, managed identities, CI runners, and break-glass access.

The engine compares these assertions against the synthetic graph and derives:

- 4 scope and coverage findings;
- 3 insufficient controls;
- 1 invalidated automated test;
- 2 conflicting exceptions; and
- 3 stale work items.

Every finding contains:

- expected state;
- observed state;
- derivation rule;
- compared entity identifiers; and
- severity.

## Human authority boundary

The agent does expensive consistency work across a graph no person holds in their
head. It is also **structurally incapable of approving anything.**

Four operations exist only as buttons in this UI:

| Operation | Where it lives |
| --- | --- |
| `approve_proposal` | Impact review — Approve on each proposal |
| `reject_proposal` | Impact review — Reject, with the reason kept for the packet |
| `edit_proposal` | Impact review — amend before accepting |
| `approve_exception` | Impact review — reapprove a lapsed risk exception |

None of them has a tool definition anywhere in this repository. Grep for them: the
only hits are the UI, the store, and the list that renders them struck through in
the **Agent authority** panel.

### The boundary is enforced, not merely observed

"Not registered" is a convention, and a convention lives in a tool description —
which is a polite request to a model. So the constraint is enforced a second time,
in code:

```ts
// lib/ripple/actor.ts
export function runAsTool<T>(toolName: string, fn: () => T): T  // sets actor kind = "tool"
export function assertHumanActor(operation: string): Actor      // throws for a tool actor
```

Every tool handler executes inside `runAsTool`. Every store write that changes
**approved** state calls `assertHumanActor` first. A write to approved state
originating from a tool handler therefore throws, however it was reached — through
an unanticipated path, a future refactor, or a model that was told to try.

Verify it from the browser console on any page:

```js
window.rippleWebMCP.callTool('approve_proposal', { id: 'PROP-ADOPT-AC2' })
// Uncaught: Unknown or unregistered WebMCP tool: approve_proposal
window.rippleWebMCP.neverRegistered  // the four, and where each one lives
```

### The policy change is itself an approval

The first row of every impact review is **“Adopt AC-2 v3 as the approved
requirement.”** Until a person approves that row, AC-2 v2 remains the requirement
the graph is measured against. The agent read the change, derived its consequences
across eight systems and drafted every remediation beneath it — and it still cannot
adopt the policy. That is the whole thesis in one row.

## Assurance readiness

Readiness is calculated rather than hardcoded:

```text
readiness = 100 × (
  0.30 × control coverage +
  0.20 × verification +
  0.25 × evidence freshness +
  0.15 × exception health +
  0.10 × review progress
)
```

Coverage and verification are risk-weighted: critical 4, high 3, moderate 2, low 1.

Two properties make the number worth trusting:

- **Coverage counts control _sufficiency_, not control presence.** A requirement
  linked to a control whose configuration contradicts it scores zero for that
  control. This is why the score moves when a requirement tightens, and why it
  cannot be improved by drawing more edges.
- **Approving a fix mutates the graph, and the analyzer re-runs against it.**
  Nothing adds points for activity. A finding disappears because the control
  behind it actually changed, and the score follows.

The seeded scenario walks: **85 → 75** when the agent drafts a review (known
problems, nobody has decided), **→ 61** the moment a human adopts AC-2 v3 (the
obligation is now stricter than the estate), and **→ 73** once the remediation is
approved and the graph actually changes. It does not return to 85, because
`EXC-07` still grants contractors TOTP and the offboarding monitor is still
failing — the packet reports both rather than rounding them away. Every one of
those numbers is computed at read time from the live graph.

## WebMCP tools

Sixteen tools, deliberately. A flat thirty-tool surface degrades model selection
accuracy, and consolidation with parameters beats more entry points.

| Group | Tools |
| --- | --- |
| **Read** | `get_standard` · `get_requirement` · `get_traceability_graph` · `get_execution_state` |
| **Analyze** | `compare_requirement_versions` · `analyze_change_impact` · `detect_gaps` · `calculate_readiness` |
| **Propose** | `propose_control` · `propose_work_item` · `propose_trace_link` · `create_impact_review` |
| **Audit** | `explain_trace_link` · `show_requirement_history` · `generate_traceability_matrix` · `generate_audit_packet` |
| **Never registered** | `approve_proposal` · `reject_proposal` · `edit_proposal` · `approve_exception` |

Authoring rules applied to all sixteen: descriptions are written for a model and
every one states when **not** to use the tool; every result carries a one-line
`summary` beside its structured data; proposal results carry a `_note` naming the
human step that follows, so the agent cannot report a proposal as a change.

### Registration is dynamic, per view

```ts
// lib/webmcp.ts
await document.modelContext.registerTool(tool, { signal: controller.signal });
```

Two details of the spec are easy to get wrong from memory and worth stating:
registration is on **`document.modelContext`** (not `navigator`, not
`window.agent`), and there is **no `unregisterTool`** — deregistration is an
`AbortSignal`. So each view holds one `AbortController`, and entering a new view
fires the previous one.

| View | Registered |
| --- | --- |
| Workspace | 4 — `get_standard`, `analyze_change_impact`, `detect_gaps`, `calculate_readiness` |
| Policy change | 4 — `get_requirement`, `compare_requirement_versions`, `show_requirement_history`, `analyze_change_impact` |
| Impact review | 8 — analysis, all four propose tools, `explain_trace_link`, `generate_audit_packet` |
| Traceability | 5 — `get_traceability_graph`, `get_requirement`, `detect_gaps`, `propose_trace_link`, `explain_trace_link` |
| Execution | 5 — `get_execution_state`, `get_requirement`, `detect_gaps`, `propose_work_item`, `explain_trace_link` |
| Evidence map | 5 — `generate_traceability_matrix`, `generate_audit_packet`, `detect_gaps`, `calculate_readiness`, `explain_trace_link` |

No view sees the whole surface; the union across views is all sixteen. The
**Agent authority** panel in the right rail shows the live set as you navigate,
next to the four that are never registered anywhere.

## File structure

```text
clauseflow/
├── .openai/hosting.json            # Sites project and capability declaration
├── app/
│   ├── globals.css                 # Responsive light enterprise design system
│   ├── layout.tsx                  # RippleTrace metadata and page shell
│   └── page.tsx                    # Route entry
├── components/
│   ├── ClauseFlowWorkspace.tsx     # Workspace shell, views, impact review
│   └── TraceGraph.tsx              # Traceability canvas (SVG, no graph library)
├── lib/
│   ├── ripple/
│   │   ├── types.ts                # Enterprise graph, assertions, provenance
│   │   ├── seed.ts                 # Wexler Systems synthetic dataset
│   │   ├── seed-extra.ts           # Identity, network, personnel, media breadth
│   │   ├── graph.ts                # Graph indexing, versioning, traversal
│   │   ├── impact.ts               # Deterministic semantic impact engine
│   │   ├── readiness.ts            # Weighted assurance calculation
│   │   ├── health.ts               # Entity health, stated in words not colour
│   │   ├── layout.ts               # Deterministic layered graph layout
│   │   ├── actor.ts                # The agent / human mutation boundary
│   │   ├── store.ts                # State; approvals mutate the graph
│   │   ├── proposals.ts            # Findings → proposals carrying real payloads
│   │   ├── tools.ts                # The 16 tools and their per-view mapping
│   │   └── scenario.ts             # Prepared AC-2 v2 → v3 scenario
│   └── webmcp.ts                   # Dynamic per-view WebMCP registration
├── public/
│   ├── favicon.svg
│   └── og.png                      # Social preview
├── LICENSE                         # MIT license
├── README.md                       # This document
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Structural rationale

- Domain reasoning lives outside React so it can be tested independently, and so
  the tool layer and the UI drive exactly the same functions.
- `actor.ts` is separate from `store.ts` on purpose: the boundary is a property of
  the system, not of any one screen.
- Prose and structured assertions coexist; analysis never parses display prose.
- Every graph edge includes provenance.
- The deterministic seed date keeps evidence freshness reproducible.
- Systems of record are represented by typed references rather than fake live API claims.
- The UI uses progressive disclosure so enterprise depth does not overwhelm the first screen.
- The dependency view is plain SVG with a breadth-first layout from whatever you
  focus on, so a node's column is its *distance from the thing you are changing*
  rather than its type. An earlier version drew all seventy-odd nodes at once in
  fixed kind-columns: most of it offscreen, edges averaging 750px, and no question
  you could answer by reading it. Nodes lead with their system of record and native
  key, because that is the identifier a person recognises and can search for.
- Controls the analyzer reached that the focused subtree does not contain get their
  own lane, labelled as such. They govern an identity class the requirement now
  covers while implementing a different requirement, so no amount of walking out
  from the focus would ever reach them — which is exactly why a person misses them.

## Run locally

Prerequisites: Node.js 22.13 or later and npm. (`vinext` uses `fs/promises.glob`,
which does not exist before Node 22 — the dev server exits immediately on Node 20
with a `does not provide an export named 'glob'` error.)

```bash
npm install
npm run dev
```

If your shell defaults to an older Node through nvm, `npm run dev:brew-node`
prepends a Homebrew Node to `PATH` for that one command.

Without a WebMCP-capable browser the app is fully usable and nothing is registered
with the user agent. On `localhost` a shim exposes the same handlers at
`window.rippleWebMCP` so you can drive every tool from the console:

```js
await window.rippleWebMCP.callTool('analyze_change_impact')
window.rippleWebMCP.listTools().map(t => t.name)   // changes as you navigate
```

The deployed origin carries a real WebMCP origin-trial token, so Chrome 149+
registers the tools natively there. No shim is ever installed off `localhost` —
the deployed page never pretends to have WebMCP it does not have.

Validate the production build:

```bash
npm run build
```

## Suggested WebMCP demo prompt

Open the deployed page in an agentic browser and say:

```text
WSEC-1 requirement AC-2 is changing to: all privileged human and workload
identities accessing production infrastructure must use phishing-resistant
authentication, with access reviewed every 90 days. Analyze the impact, but
don't touch approved controls or sprint work.
```

`analyze_change_impact` needs no arguments — the pending change is on the page —
so a judge gets the whole analysis from one sentence. Expected sequence:
`analyze_change_impact` → `get_traceability_graph` → `detect_gaps` →
`create_impact_review`.

**14 findings, all derived.** Readiness **85 → 70** if adopted as written, with the
breakdown visible. Among them, three controls nobody linked to AC-2:

- `CTL-118` (Entra Access Reviews, under AC-5) runs annually, not every 90 days.
- `CTL-152` (Okta contractors, under SR-2) runs semi-annually.
- `CTL-175` (Vault privileged secrets, under IA-5) permits a passphrase for
  break-glass identities — which AC-2 v3 has just brought into scope.

The analyzer finds these by scanning identity classes, not links. A person would
have to already know they existed to check them.

`test-entra-ca-mfa-required` is reported as no longer proving AC-2 **while still
passing**: it asserts that MFA is required, never which factors are permitted.

Then push back with something the agent could not have known:

```text
Break-glass accounts for the regional control planes can't depend on Entra —
that's the whole point of break-glass. They need a compensating control, not
hardware keys.
```

It does not overwrite the requirement and does not argue. It proposes
offline-sealed credentials with dual-authorization retrieval, a Splunk alert on
any use, and a 24-hour post-incident review, plus a dated rewrite of `EXC-11` —
into the review, for a person to decide.

Approve some in the UI, reject one, then ask for `generate_audit_packet`. It
returns AC-2 before and after, the accepted interpretation of break-glass and who
accepted it, affected controls with their `sourceRef`s, the rejected proposal with
its reason, the named decision-maker on each approval, and the gaps still open.

## Three-minute presentation

1. Begin on the incoming Confluence event and ask, “What breaks if we approve this?”
2. Ask the browser agent to investigate using WebMCP while the live tool timeline fills.
3. Show the readiness drop and 14 grounded findings.
4. Open `F-008` and its GitHub, Entra, Sheets, and evidence records.
5. Ask the agent to create proposals and stop at the human authority boundary.
6. Approve one exact proposal ID and show readiness, audit, and execution state change.
7. Finish on Evidence Map: the test is green, but the strengthened policy is not proven.

## Limitations

- RippleTrace does not certify compliance or provide legal advice.
- All integrations are represented, not live.
- The prototype contains one deeply modeled change scenario.
- State resets when the page reloads.
- Production use would require server-side persistence, SSO, RBAC, connector authorization, and immutable audit storage.

## License

MIT — see [LICENSE](LICENSE).
