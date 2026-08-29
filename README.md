# ClauseFlow

**From policy to provable execution.**

ClauseFlow is a WebMCP-powered enterprise workspace that connects policy requirements to controls, sprint work, tests, evidence, exceptions, and human decisions. It demonstrates how a person and a browser agent can maintain semantic traceability together without letting the agent silently change approved organizational records.

> All organizations, people, policies, evidence, and systems in this repository are fictional synthetic demonstration data.

## Why this product exists

Enterprise intent is commonly documented in a wiki while execution is tracked in boards, repositories, test systems, and spreadsheets. Links between those artifacts become stale when policy language changes. ClauseFlow makes the relationship explicit:

```text
Requirement → Control → Work item → Test → Evidence
                    ↘ Exception → Decision
```

The hackathon scenario changes a broad MFA requirement into a requirement for phishing-resistant authentication and quarterly access review. ClauseFlow detects that the existing control, implementation task, evidence, and contractor exception are no longer sufficient. It prepares proposals, but a named human must approve or reject each one.

## Product principles and rationale

### 1. Propose; never silently approve

Semantic analysis and organizational authority are different responsibilities. Agent-created consequences are stored as `Proposal` records. They become part of decision history only after a human action. This makes the safety boundary visible in both the UI and the WebMCP tool names.

### 2. Shared state instead of a chatbot sidebar

Every agent operation updates the same standards, graph, board, and impact-review surfaces the human uses. WebMCP is not a chat feature layered over the app; it is an alternate structured interface to the application domain.

### 3. Deterministic demo behavior

The impact scenario is intentionally deterministic. It avoids external model, identity-provider, and enterprise API dependencies, making judging reproducible and preventing synthetic demo claims from being confused with real compliance conclusions.

### 4. Provenance over automation

Agent-proposed work is visibly labeled. Approved and rejected decisions retain an actor, timestamp, rationale, and proposal identity. Trace links therefore communicate not only what is connected, but why and by whom.

### 5. Synthetic enterprise data

Real enterprise policy and audit evidence is confidential. The repository uses a fictional company, Northstar Financial, to demonstrate an enterprise-grade workflow without requiring organization access or exposing private information.

## Features

- Structured identity-security standard with versioned requirements
- One-click deterministic policy revision and impact analysis
- Requirement → control → work → evidence traceability graph
- Sprint-style execution board with approved agent-proposed work
- Human approval and rejection controls for every proposal
- Decision history with actor, timestamp, rationale, and provenance
- Coverage-readiness score that responds to unresolved decisions
- Seven registered WebMCP tools
- Responsive layout and print-friendly decision report
- Resettable synthetic demonstration scenario
- Social preview image and metadata

## WebMCP tools

The tools are registered in `lib/webmcp.ts` through `document.modelContext.registerTool(...)`.

| Tool | Purpose | Mutation boundary |
| --- | --- | --- |
| `get_requirement` | Read one approved requirement | Read-only |
| `get_traceability_graph` | Read requirements, controls, work, and evidence | Read-only |
| `analyze_change_impact` | Evaluate downstream consequences of IDS-01 | Analysis only |
| `create_impact_review` | Create draft proposals for human review | Draft-only |
| `approve_proposal` | Approve one selected proposal | Human-controlled mutation |
| `reject_proposal` | Reject one selected proposal | Human-controlled mutation |
| `generate_traceability_report` | Produce structured readiness and provenance data | Read-only |

The tool descriptions explicitly state whether an action is read-only, draft-only, or mutating. This improves agent selection and makes intent boundaries auditable.

## Architecture

```text
Browser agent
    │ structured WebMCP calls
    ▼
lib/webmcp.ts
    │ delegates to live workspace actions
    ▼
ClauseFlowWorkspace state and domain functions
    ├── Standards workspace
    ├── Traceability graph
    ├── Execution board
    ├── Impact review
    └── Decision history
            │
            ▼
    Synthetic typed domain records
```

The UI and WebMCP tools share the same `analyze`, `decide`, and reporting actions. This prevents two inconsistent implementations of the product workflow.

## File structure

```text
clauseflow/
├── .openai/
│   └── hosting.json              # Sites deployment capability declaration
├── app/
│   ├── globals.css               # Complete visual system and responsive behavior
│   ├── layout.tsx                # Document shell and social metadata
│   └── page.tsx                  # Route entry; mounts the client workspace
├── components/
│   └── ClauseFlowWorkspace.tsx   # Interactive product views and domain actions
├── lib/
│   ├── demo-data.ts              # Synthetic organization and revision scenario
│   ├── types.ts                  # Typed enterprise-domain model
│   └── webmcp.ts                 # WebMCP registration and tool schemas
├── public/
│   ├── favicon.svg
│   └── og.png                    # ClauseFlow social preview
├── LICENSE                       # MIT open-source license
├── README.md                     # Product, architecture, setup, and demo guide
├── package.json                  # Scripts and pinned dependencies
├── tsconfig.json                 # Strict TypeScript configuration
└── vite.config.ts                # Vinext, Sites, Tailwind, and Cloudflare build
```

### Why this structure

- `lib/types.ts` isolates the stable domain vocabulary from presentation code.
- `lib/demo-data.ts` makes synthetic assumptions easy to audit and later replace with adapters.
- `lib/webmcp.ts` keeps the agent interface explicit and reviewable rather than scattering registrations through components.
- `ClauseFlowWorkspace.tsx` owns the prototype state because the demo requires no remote persistence or authentication.
- `app/page.tsx` remains deliberately small so routing and product behavior are not coupled.

## Data model

The important records are:

- `Requirement`: versioned policy statement, owner, effective date, and status
- `Control`: operational mechanism implementing a requirement
- `WorkItem`: sprint execution record connected to a control
- `Evidence`: time-bound proof produced by a system or process
- `PolicyException`: approved deviation with a reason and expiration
- `Proposal`: agent-drafted consequence awaiting human review
- `Decision`: immutable-style history entry recording a human outcome

For a production implementation these records would live in a database and be integrated through adapters for document, work, test, and evidence systems. The prototype keeps them in browser memory to stay fast, safe, and resettable.

## Run locally

### Prerequisites

- Node.js 22.13 or later
- npm

### Commands

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

Production validation:

```bash
npm run build
```

## WebMCP testing

Use either:

- ChatGPT desktop's in-app browser, which supports WebMCP, or
- A browser build with WebMCP testing enabled.

Suggested prompt:

```text
Read IDS-01, analyze its change impact, and create an impact review.
Do not approve or reject any proposal.
```

Then ask:

```text
Explain which existing evidence is insufficient and why.
```

The human can approve or reject proposals in the visible review panel, or explicitly instruct the agent to act on a selected proposal.

## Three-minute demo script

1. Establish Northstar Financial as synthetic and show the approved v1 standard.
2. Ask the browser agent to analyze IDS-01 without changing approved records.
3. Watch the policy revision, readiness score, requirements, and impact panel update.
4. Open the traceability graph and show the semantic break between MFA evidence and phishing-resistant proof.
5. Approve the passkey work proposal and reject one unsuitable proposal.
6. Open the execution board to show approved agent-proposed work.
7. Open decision history to show human accountability and provenance.
8. Briefly show `lib/webmcp.ts` and explain that the agent used structured application tools rather than UI guessing.

## Production integration path

The prototype deliberately avoids real enterprise credentials. A production version would introduce adapters such as:

```ts
interface WorkSource {
  listWorkItems(): Promise<WorkItem[]>;
  updateWorkItem(id: string, change: Partial<WorkItem>): Promise<void>;
}

interface DocumentSource {
  listStandards(): Promise<Requirement[]>;
}

interface EvidenceSource {
  listEvidence(controlId: string): Promise<Evidence[]>;
}
```

Possible adapters include Confluence, SharePoint, Jira, Azure Boards, GitHub, and identity providers. They are roadmap items, not simulated claims in the current product.

## Limitations

- The product does not certify compliance or provide legal advice.
- The current impact engine implements one curated identity-policy scenario.
- State resets when the page reloads.
- External enterprise integrations and authentication are not included.
- Human approval is modeled in the UI; production use would enforce identity, RBAC, and server-side authorization.

## License

MIT — see [LICENSE](LICENSE).
