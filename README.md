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
4. **Impact review** — deterministic comparisons derive 13 findings, each with exact record IDs and an evidence drawer.
5. **Human decision** — draft proposals remain inert until Dana Lindqvist approves or rejects a specific proposal ID.
6. **Governed execution** — approved proposals visibly change readiness, audit history, and downstream work state.
7. **Reset** — **Reset Wexler scenario** restores the original unassessed event for repeatable judging.

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

Analysis changes nothing. Findings become draft proposals. Each proposal must be approved or rejected separately by a named human reviewer.

The design separates:

- **language work:** translating policy into assertions;
- **deterministic work:** calculating downstream consequences;
- **organizational authority:** approving what becomes company truth.

## Assurance readiness

Readiness is calculated rather than hardcoded:

```text
readiness = 100 × (
  0.30 × control coverage +
  0.20 × verification +
  0.25 × evidence freshness +
  0.15 × exception health +
  0.10 × open proposals
)
```

Coverage and verification are risk-weighted: critical 4, high 3, moderate 2, low 1.

## WebMCP tools

`lib/webmcp.ts` registers thirteen granular tools. Each returns JSON-compatible structured data rather than a JSON string:

| Tool | Purpose | Boundary |
| --- | --- | --- |
| `get_policy_change` | Read the incoming Confluence change event | Read-only |
| `list_connected_systems` | Discover systems and exact record IDs | Read-only |
| `get_source_record` | Inspect one exact record and its provenance | Read-only |
| `trace_ac2_dependencies` | Traverse the bounded AC-2 evidence chain | Read-only |
| `analyze_change_impact` | Derive consequences of AC-2 v3 | Analysis only |
| `list_impact_findings` | List grounded findings, optionally by severity | Read-only |
| `explain_finding` | Return expected, observed, rules, and citations | Read-only |
| `calculate_readiness` | Return weighted score and breakdown | Read-only |
| `create_impact_review` | Convert findings into draft proposals | Draft-only |
| `list_remediation_proposals` | Inspect proposal targets and decision state | Read-only |
| `approve_proposal` | Approve one explicitly selected proposal | Human-controlled mutation |
| `reject_proposal` | Reject one explicitly selected proposal | Human-controlled mutation |
| `reset_wexler_scenario` | Restore the repeatable synthetic scenario | Local demo mutation |

The visual interface and WebMCP tools call the same analysis and decision functions.

## File structure

```text
clauseflow/
├── .openai/hosting.json            # Sites project and capability declaration
├── app/
│   ├── globals.css                 # Responsive light enterprise design system
│   ├── layout.tsx                  # RippleTrace metadata and page shell
│   └── page.tsx                    # Route entry
├── components/
│   └── ClauseFlowWorkspace.tsx     # RippleTrace guided workspace and interactions
├── lib/
│   ├── ripple/
│   │   ├── types.ts                # Enterprise graph, assertions, provenance
│   │   ├── seed.ts                 # Wexler Systems synthetic dataset
│   │   ├── graph.ts                # Graph indexing and traversal
│   │   ├── impact.ts               # Deterministic semantic impact engine
│   │   ├── readiness.ts            # Weighted assurance calculation
│   │   └── scenario.ts             # Prepared AC-2 v2 → v3 scenario
│   └── webmcp.ts                   # RippleTrace WebMCP registration
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

- Domain reasoning lives outside React so it can be tested independently.
- Prose and structured assertions coexist; analysis never parses display prose.
- Every graph edge includes provenance.
- The deterministic seed date keeps evidence freshness reproducible.
- Systems of record are represented by typed references rather than fake live API claims.
- The UI uses progressive disclosure so enterprise depth does not overwhelm the first screen.

## Run locally

Prerequisites: Node.js 22.13 or later and npm.

```bash
npm install
npm run dev
```

Validate the production build:

```bash
npm run build
```

## Suggested WebMCP demo prompt

```text
Investigate AC2-CHG-2026-017 using only this page's WebMCP tools. Inspect the
policy change, trace AC-2 dependencies, analyze impact, calculate readiness,
create draft remediation proposals, and explain F-008 with exact source-record
citations. Do not approve or reject anything. Stop for my decision.
```

## Three-minute presentation

1. Begin on the incoming Confluence event and ask, “What breaks if we approve this?”
2. Ask the browser agent to investigate using WebMCP while the live tool timeline fills.
3. Show the readiness drop and 13 grounded findings.
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
