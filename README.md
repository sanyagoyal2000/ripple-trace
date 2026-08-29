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

## Guided user journey

The interface deliberately reveals complexity in stages:

1. **Connected systems** — lets judges open realistic, source-shaped previews for Confluence, Sheets, Jira, Azure Boards, SharePoint, CI pipelines, identity, Terraform, ServiceNow, and Vanta records.
2. **Policy change** — compares approved AC-2 v2 with proposed AC-2 v3.
3. **Impact review** — derives 13 findings and presents individually reviewable proposals.
4. **Execution** — shows which Jira and Azure Boards work items now have stale acceptance criteria.
5. **Evidence map** — follows one claim from policy to control, test, and evidence, explaining why a green test may no longer prove the stronger requirement.

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

`lib/webmcp.ts` registers seven tools:

| Tool | Purpose | Boundary |
| --- | --- | --- |
| `get_traceability_graph` | Read the cross-system graph and provenance | Read-only |
| `analyze_change_impact` | Derive consequences of AC-2 v3 | Analysis only |
| `calculate_readiness` | Return weighted score and breakdown | Read-only |
| `create_impact_review` | Convert findings into draft proposals | Draft-only |
| `explain_finding` | Return expected, observed, and compared records | Read-only |
| `approve_proposal` | Approve one selected proposal | Human-controlled mutation |
| `reject_proposal` | Reject one selected proposal | Human-controlled mutation |

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
Analyze the proposed AC-2 change and create an impact review.
Do not approve or reject any proposal.
Then explain finding F-008.
```

## Three-minute presentation

1. Open Connected Systems and switch between source records so the audience immediately recognizes the fragmented enterprise landscape. These are deterministic demo representations, not live vendor accounts.
2. Compare AC-2 v2 and v3 on Policy Change.
3. Ask the browser agent to analyze without changing approved records.
4. Show the readiness drop and 13 derived findings.
5. Expand “Why was this flagged?” for the passing-but-invalidated test.
6. Approve one proposal and reject another.
7. Show affected Jira and Azure Boards work in Execution.
8. Finish on Evidence Map with provenance and the WebMCP tool definitions.

## Limitations

- RippleTrace does not certify compliance or provide legal advice.
- All integrations are represented, not live.
- The prototype contains one deeply modeled change scenario.
- State resets when the page reloads.
- Production use would require server-side persistence, SSO, RBAC, connector authorization, and immutable audit storage.

## License

MIT — see [LICENSE](LICENSE).
