/**
 * The tool surface — 16 tools, and the four operations deliberately absent.
 *
 * Authoring rules applied to every tool:
 *   - Descriptions are written for a model, and each states when *not* to use
 *     the tool. A 16-tool surface only stays selectable if the boundaries
 *     between tools are explicit.
 *   - Every result carries a one-line `summary` alongside its structured data.
 *   - Proposal results carry `_note` naming the human step that follows, so the
 *     agent cannot report a proposal as a completed change.
 *   - Results are projections, never raw entities.
 */

import {
  allExceptions,
  allWorkItems,
  controlsFor,
  currentRequirement,
  currentRequirements,
  edgesTo,
  evidenceFor,
  isEvidenceStale,
  isExceptionExpiringSoon,
  isUnverifiedLink,
  testsFor,
  versionsOf,
  workItemsFor,
  type GraphIndex,
} from './graph';
import { describeAssertion, detectGaps, diffRequirementVersions } from './impact';
import { proposedRequirement } from './scenario';
import {
  CHANGE_ID,
  addProposal,
  applyReviewerConstraint,
  createReview as createReviewInStore,
  getState,
  graphIndex,
  logActivity,
  projectedReadiness,
  readiness as currentReadiness,
  runAnalysis,
  selectEntity,
  type ViewId,
} from './store';
import type { Entity, Proposal, SourceRef, SourceSystem, TraceEdge } from './types';

export interface ToolResult {
  summary: string;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  views: ViewId[];
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  touched?: (result: ToolResult) => string[];
  execute: (input: Record<string, unknown>) => ToolResult;
}

export const PROPOSAL_NOTE =
  'This is a proposal, not a change. It is queued in the impact review and has no effect on ' +
  'approved state. A human reviewer must approve, edit, or reject it in the RippleTrace UI. You ' +
  'cannot approve it: no approval tool is registered with you, and the store refuses approved-state ' +
  'writes that originate from a tool handler.';

const chip = (ref: SourceRef) => `${ref.system}:${ref.ref}`;
const index = (): GraphIndex => graphIndex();
const today = () => getState().today;
const noInput = { type: 'object' as const, properties: {}, additionalProperties: false };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const proposing = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

function recordsFrom(systems: SourceSystem[]): Entity[] {
  return [...index().entities.values()].filter((entity) => systems.includes(entity.sourceRef.system));
}

function projectSourceRecord(entity: Entity) {
  return { ...entity, nativeId: entity.sourceRef.ref, system: entity.sourceRef.system, source: chip(entity.sourceRef) };
}

function findNativeRecord(systems: SourceSystem[], ref: unknown): Entity | undefined {
  const wanted = String(ref ?? '').trim().toLowerCase();
  return recordsFrom(systems).find(
    (entity) => entity.sourceRef.ref.toLowerCase() === wanted || entity.id.toLowerCase() === wanted,
  );
}

function sourceLookupTool(
  name: string,
  title: string,
  description: string,
  systems: SourceSystem[],
  inputName: string,
  inputDescription: string,
): ToolDefinition {
  return {
    name,
    title,
    description,
    views: ['overview', 'change', 'impact', 'graph', 'execution', 'evidence'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: { [inputName]: { type: 'string', description: inputDescription } },
      required: [inputName],
      additionalProperties: false,
    },
    touched: (result) => [String((result.record as { id?: string })?.id ?? '')].filter(Boolean),
    execute: (input) => {
      const ref = input[inputName];
      const record = findNativeRecord(systems, ref);
      if (!record) {
        return {
          summary: `No ${systems.join('/')} record '${String(ref)}' exists in the Wexler scenario.`,
          availableNativeIds: recordsFrom(systems).map((entity) => entity.sourceRef.ref),
        };
      }
      selectEntity(record.id);
      return { summary: `${record.sourceRef.system}:${record.sourceRef.ref} — ${record.title}`, record: projectSourceRecord(record) };
    },
  };
}

function projectEdge(i: GraphIndex, edge: TraceEdge) {
  return {
    id: edge.id,
    type: edge.type,
    from: edge.from,
    to: edge.to,
    state: edge.provenance.state,
    origin: edge.provenance.origin,
    verified: edge.provenance.lastVerified ?? null,
  };
}

function queue(proposal: Proposal): ToolResult {
  // Proposal-queue writes are agent-callable; approved state is not.
  addProposal(proposal);
  return {
    summary: `Proposed: ${proposal.title}. Queued for human review as ${proposal.id}.`,
    proposal: { id: proposal.id, kind: proposal.kind, title: proposal.title, status: 'pending' },
    _note: PROPOSAL_NOTE,
  };
}

let proposalSeq = 0;
const agentProposalId = (prefix: string) => `PROP-AG-${prefix}-${++proposalSeq}`;

const readTools: ToolDefinition[] = [
  // ---------------------------------------------------------------- read (4)
  {
    name: 'get_standard',
    title: 'Get the active standard and the pending change',
    description:
      'Return the active security standard, a one-line projection of every requirement in it ' +
      `(code, title, risk, owner, control count, stale-evidence count), and the pending change ` +
      `event ${CHANGE_ID} awaiting assessment. Start here when you do not yet know which ` +
      'requirement a question concerns, or when the user names a change by its ticket id. ' +
      'Do NOT use this to read the full text or assertions of one requirement — it returns ' +
      'summaries only; call get_requirement. Do NOT call it as a warm-up before every other tool.',
    views: ['overview'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'uncovered', 'critical', 'stale_evidence'],
          description:
            "Restrict the requirement list. 'uncovered' returns requirements with no implementing " +
            "control; 'stale_evidence' those resting on evidence past its freshness window.",
        },
      },
      additionalProperties: false,
    },
    execute: ({ filter = 'all' }) => {
      const i = index();
      const standard = [...i.entities.values()].find((e) => e.kind === 'standard');
      if (standard?.kind !== 'standard') return { summary: 'No standard loaded.' };
      let requirements = currentRequirements(i).map((r) => ({
        id: r.requirementId,
        code: r.code,
        version: r.version,
        title: r.title,
        risk: r.riskLevel,
        owner: r.owner,
        controls: controlsFor(i, r.requirementId).map((c) => c.code),
        staleEvidence: controlsFor(i, r.requirementId)
          .flatMap((c) => evidenceFor(i, c.id))
          .filter((e) => isEvidenceStale(e, today())).length,
        source: chip(r.sourceRef),
      }));
      if (filter === 'uncovered') requirements = requirements.filter((r) => r.controls.length === 0);
      if (filter === 'critical') requirements = requirements.filter((r) => r.risk === 'critical');
      if (filter === 'stale_evidence') requirements = requirements.filter((r) => r.staleEvidence > 0);

      return {
        summary:
          `${standard.code} v${standard.version} — ${requirements.length} requirement(s); ` +
          `change ${CHANGE_ID} is unassessed and awaiting analysis.`,
        standard: {
          code: standard.code,
          title: standard.title,
          version: standard.version,
          owner: standard.owner,
          frameworks: standard.frameworks,
          source: chip(standard.sourceRef),
        },
        pendingChange: {
          id: CHANGE_ID,
          requirementId: 'AC-2',
          proposedBy: 'p.okafor@wexler.example',
          source: 'confluence:WSEC/pages/884215?version=5',
          authorityState: 'draft_requires_human_approval',
          proposedText: proposedRequirement.text,
        },
        requirements,
      };
    },
  },

  {
    name: 'get_requirement',
    title: 'Get one requirement in full',
    description:
      'Return one requirement — full text, machine-readable assertions, applicability, owner, ' +
      'verification method — plus its version history and the subtree beneath it (controls, their ' +
      'tests and evidence, work items, exceptions). Use it before analyzing a change, so you diff ' +
      'against the real current version rather than an assumption. ' +
      'Do NOT use it to survey many requirements; it is deliberately verbose for one. Do NOT use ' +
      'it to fetch the graph for rendering — that is get_traceability_graph.',
    views: ['change', 'graph', 'execution'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: {
          type: 'string',
          description: "Stable requirement code, e.g. 'AC-2'. Not a version id like 'AC-2@2'.",
        },
      },
      required: ['requirementId'],
      additionalProperties: false,
    },
    touched: (r) => [String((r.requirement as { versionId?: string })?.versionId ?? '')].filter(Boolean),
    execute: ({ requirementId }) => {
      const i = index();
      const id = String(requirementId);
      const r = currentRequirement(i, id);
      if (!r) {
        return {
          summary: `No requirement '${id}' in the active standard.`,
          availableIds: currentRequirements(i).map((x) => x.requirementId),
        };
      }
      const controls = controlsFor(i, id);
      selectEntity(r.id);
      return {
        summary:
          `${r.code} v${r.version} (${r.riskLevel}, ${r.approvalStatus}) owned by ${r.owner}; ` +
          `${controls.length} control(s), ${versionsOf(i, id).length} version(s) on record.`,
        requirement: {
          id: r.requirementId,
          versionId: r.id,
          code: r.code,
          version: r.version,
          title: r.title,
          text: r.text,
          owner: r.owner,
          ownerTeam: r.ownerTeam,
          applicability: r.applicability,
          riskLevel: r.riskLevel,
          verificationMethod: r.verificationMethod,
          obligations: r.assertions.map(describeAssertion),
          assertions: r.assertions,
          source: chip(r.sourceRef),
        },
        controls: controls.map((c) => ({
          code: c.code,
          status: c.implementationStatus,
          covers: c.coversIdentityClasses,
          configured: c.properties.map(describeAssertion),
          enforcedIn: c.enforcedIn.map(chip),
          tests: testsFor(i, c.id).map((t) => `${t.id} [${t.lastResult}]`),
          evidence: evidenceFor(i, c.id).map((e) => `${e.id}${isEvidenceStale(e, today()) ? ' STALE' : ''}`),
          work: workItemsFor(i, c.id).map((w) => chip(w.sourceRef)),
        })),
      };
    },
  },

  {
    name: 'get_traceability_graph',
    title: 'Get the traceability graph',
    description:
      'Return graph nodes and edges as compact projections. Its purpose is to make *absence* ' +
      "legible: pass a filter to get the broken shape you are looking for. 'uncovered' = " +
      "requirements with no implementing control and work fulfilling nothing; 'stale_evidence' = " +
      "evidence past its freshness window and what rests on it; 'expiring_exceptions' = carve-outs " +
      "lapsing within 30 days; 'unverified_links' = edges proposed or never confirmed by a human. " +
      "Do NOT call this with filter 'all' merely to look around — narrow with rootId and depth. " +
      'Do NOT use it to decide whether a change breaks something; that is analyze_change_impact.',
    views: ['graph'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'uncovered', 'stale_evidence', 'expiring_exceptions', 'unverified_links'],
          description: "Which slice of the graph to return. Defaults to 'all'.",
        },
        rootId: {
          type: 'string',
          description: "Restrict to the neighbourhood of this entity, e.g. 'AC-2' or 'CTL-114'.",
        },
        depth: { type: 'number', description: 'Hops from rootId. Defaults to 2.' },
        includeProvenance: {
          type: 'boolean',
          description:
            'Include each edge’s full provenance record rather than just its state. Costly; ' +
            'prefer explain_trace_link for one edge.',
        },
      },
      additionalProperties: false,
    },
    touched: (r) => ((r.nodes as { id: string }[] | undefined) ?? []).map((n) => n.id),
    execute: ({ filter = 'all', rootId, depth = 2, includeProvenance = false }) => {
      const i = index();
      const t = today();
      const resolve = (entityId: string) => currentRequirement(i, entityId)?.id ?? entityId;

      let ids: Set<string>;
      if (rootId) {
        ids = new Set([resolve(String(rootId))]);
        let frontier = [...ids];
        for (let hop = 0; hop < Number(depth); hop++) {
          const next: string[] = [];
          for (const id of frontier) {
            for (const edge of [...(i.outgoing.get(id) ?? []), ...(i.incoming.get(id) ?? [])]) {
              for (const other of [resolve(edge.from), resolve(edge.to)]) {
                if (!ids.has(other)) {
                  ids.add(other);
                  next.push(other);
                }
              }
            }
          }
          frontier = next;
        }
      } else {
        ids = new Set(
          [...i.entities.keys()].filter((id) => {
            const e = i.entities.get(id);
            return e && e.kind !== 'standard' && !(e.kind === 'requirement' && e.approvalStatus === 'superseded');
          }),
        );
      }

      if (filter !== 'all') {
        const keep = new Set<string>();
        if (filter === 'uncovered') {
          for (const r of currentRequirements(i)) if (!controlsFor(i, r.requirementId).length) keep.add(r.id);
          for (const w of allWorkItems(i)) {
            if (!(i.outgoing.get(w.id) ?? []).some((e) => e.type === 'fulfills')) keep.add(w.id);
          }
        }
        if (filter === 'stale_evidence') {
          for (const e of i.entities.values()) {
            if (e.kind === 'evidence' && isEvidenceStale(e, t)) {
              keep.add(e.id);
              for (const edge of i.outgoing.get(e.id) ?? []) keep.add(resolve(edge.to));
            }
          }
        }
        if (filter === 'expiring_exceptions') {
          for (const e of allExceptions(i)) {
            if (isExceptionExpiringSoon(e, t) || e.status !== 'active') {
              keep.add(e.id);
              for (const c of e.exemptsControlIds) keep.add(c);
            }
          }
        }
        if (filter === 'unverified_links') {
          for (const edge of i.edges) {
            if (isUnverifiedLink(edge)) {
              keep.add(resolve(edge.from));
              keep.add(resolve(edge.to));
            }
          }
        }
        ids = new Set([...ids].filter((id) => keep.has(id)));
      }

      const nodes = [...ids]
        .map((id) => i.entities.get(id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          label: 'code' in e && e.code ? e.code : e.id,
          title: e.title,
          source: chip(e.sourceRef),
          ...(e.kind === 'requirement' ? { risk: e.riskLevel, uncovered: !controlsFor(i, e.requirementId).length } : {}),
          ...(e.kind === 'control' ? { status: e.implementationStatus } : {}),
          ...(e.kind === 'evidence' ? { stale: isEvidenceStale(e, t) } : {}),
          ...(e.kind === 'work_item' ? { status: e.status } : {}),
          ...(e.kind === 'exception' ? { expiresAt: e.expiresAt, status: e.status } : {}),
        }));

      const edges = i.edges
        .filter((e) => ids.has(resolve(e.from)) && ids.has(resolve(e.to)))
        .map((e) => (includeProvenance ? { ...projectEdge(i, e), provenance: e.provenance } : projectEdge(i, e)));

      return {
        summary:
          `${nodes.length} node(s), ${edges.length} edge(s)` +
          (filter === 'all' ? '' : ` matching '${filter}'`) +
          (rootId ? ` within ${depth} hop(s) of ${rootId}` : '') + '.',
        filter,
        nodes,
        edges,
      };
    },
  },

  {
    name: 'get_execution_state',
    title: 'Get the execution board',
    description:
      'Return every work item joined to the control it fulfills and the requirement that stays ' +
      'unsatisfied if it slips, across both trackers — Jira for the core org, Azure Boards for the ' +
      'business unit acquired in 2019 and never consolidated. Use it to answer who is doing what, ' +
      'what is blocked, and which obligation a piece of engineering work actually serves. ' +
      'Do NOT use it to propose new work — that is propose_work_item. Do NOT use it to check ' +
      'whether existing work survived a requirement change; analyze_change_impact decides that.',
    views: ['execution'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        team: {
          type: 'string',
          enum: ['Platform Identity', 'Cloud SRE', 'Developer Experience', 'GRC', 'Gov Cloud'],
          description: 'Restrict to one team.',
        },
        status: {
          type: 'string',
          enum: ['backlog', 'in_progress', 'in_review', 'done', 'blocked'],
          description: 'Restrict to one status.',
        },
        onlyOrphans: {
          type: 'boolean',
          description: 'Return only work that fulfills no control — engineering nobody can trace.',
        },
      },
      additionalProperties: false,
    },
    touched: (r) => ((r.items as { id: string }[] | undefined) ?? []).map((x) => x.id),
    execute: ({ team, status, onlyOrphans = false }) => {
      const i = index();
      let items = allWorkItems(i).map((w) => {
        const controls = (i.outgoing.get(w.id) ?? [])
          .filter((e) => e.type === 'fulfills')
          .map((e) => i.entities.get(e.to))
          .filter((e) => e?.kind === 'control');
        return {
          id: w.id,
          ref: chip(w.sourceRef),
          tracker: w.sourceRef.system,
          title: w.title,
          team: w.team,
          sprint: w.sprint ?? null,
          status: w.status,
          assignee: w.assignee ?? null,
          implementsControls: controls.map((c) => (c?.kind === 'control' ? c.code : '')),
          unsatisfiedIfSlipped: controls.flatMap((c) =>
            c ? (i.outgoing.get(c.id) ?? []).filter((e) => e.type === 'implements').map((e) => e.to) : [],
          ),
          acceptanceCriteria: w.acceptanceCriteria,
          staleReason: w.staleReason ?? null,
        };
      });
      if (team) items = items.filter((x) => x.team === team);
      if (status) items = items.filter((x) => x.status === status);
      if (onlyOrphans) items = items.filter((x) => x.implementsControls.length === 0);

      const counts = items.reduce<Record<string, number>>((acc, x) => {
        acc[x.status] = (acc[x.status] ?? 0) + 1;
        return acc;
      }, {});
      const orphans = items.filter((x) => !x.implementsControls.length).length;
      return {
        summary:
          `${items.length} work item(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}` +
          (orphans ? `. ${orphans} fulfill no control.` : '.'),
        counts,
        items,
      };
    },
  },
];

const analyzeTools: ToolDefinition[] = [
  {
    name: 'compare_requirement_versions',
    title: 'Diff two requirement versions',
    description:
      'Semantic diff between two versions of a requirement — not a text diff. Reports which ' +
      'obligations tightened, loosened, were added or dropped; which identity classes came into or ' +
      'out of scope; and whether the verification method changed. "Tightened" is the classification ' +
      'that matters: it is what invalidates a control, a test, or an exception. With no arguments ' +
      `it diffs the current AC-2 against the pending change ${CHANGE_ID}. ` +
      'Do NOT use this to find out what breaks — it describes the change, not its consequences, ' +
      'and analyze_change_impact runs this diff internally and returns it.',
    views: ['change'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string', description: "Stable code, e.g. 'AC-2'. Defaults to the pending change." },
        fromVersion: { type: 'number', description: 'Version to compare from. Defaults to the current approved version.' },
        toVersion: { type: 'number', description: 'Version to compare to. Omit to compare against the pending change.' },
      },
      additionalProperties: false,
    },
    execute: ({ requirementId = 'AC-2', fromVersion, toVersion }) => {
      const i = index();
      const id = String(requirementId);
      const versions = versionsOf(i, id);
      const before =
        fromVersion === undefined
          ? currentRequirement(i, id)
          : versions.find((v) => v.version === Number(fromVersion));
      if (!before) return { summary: `No version of '${id}' to compare from.` };
      const after =
        toVersion !== undefined
          ? versions.find((v) => v.version === Number(toVersion))
          : id === 'AC-2'
            ? proposedRequirement
            : undefined;
      if (!after) {
        return {
          summary: `Nothing to compare to for '${id}'. Pass toVersion, or use AC-2 for the pending change.`,
          availableVersions: versions.map((v) => v.version),
        };
      }
      const diff = diffRequirementVersions(before, after);
      return {
        summary: diff.summary,
        diff,
        obligations: {
          before: before.assertions.map(describeAssertion),
          after: after.assertions.map(describeAssertion),
        },
      };
    },
  },

  {
    name: 'analyze_change_impact',
    title: 'Analyze the impact of the requirement change',
    description:
      'The primary analysis tool, and a deterministic one: it compares assertion objects across the ' +
      'live graph and never asks a model what breaks. Returns identity classes newly in scope, ' +
      'controls whose configuration no longer satisfies the requirement (including controls owned ' +
      'by other teams that are not even linked to it), tests that no longer prove it despite still ' +
      'passing, exceptions whose granted relief is no longer permissible, and in-flight work whose ' +
      'acceptance criteria are now out of date. Every finding carries the comparison that produced ' +
      `it. Called with no arguments it analyzes the pending change ${CHANGE_ID}. ` +
      'This tool computes and returns; it changes nothing and approves nothing. Follow it with ' +
      'create_impact_review to turn findings into reviewable proposals. ' +
      'Do NOT use it for standing drift unrelated to a change — that is detect_gaps.',
    views: ['overview', 'change', 'impact'],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        severityAtLeast: {
          type: 'string',
          enum: ['info', 'low', 'moderate', 'high', 'critical'],
          description: 'Drop findings below this severity from the returned list.',
        },
      },
      additionalProperties: false,
    },
    touched: (r) => ((r.findings as { entityIds: string[] }[] | undefined) ?? []).flatMap((f) => f.entityIds),
    execute: ({ severityAtLeast }) => {
      const order = ['info', 'low', 'moderate', 'high', 'critical'];
      let findings = runAnalysis();
      if (severityAtLeast) {
        const floor = order.indexOf(String(severityAtLeast));
        findings = findings.filter((f) => order.indexOf(f.severity) >= floor);
      }
      const now = currentReadiness();
      const after = projectedReadiness();
      const byKind = (kind: string) => findings.filter((f) => f.kind === kind).length;
      return {
        summary:
          `${findings.length} finding(s) — ${byKind('scope_expansion') + byKind('coverage_gap')} scope, ` +
          `${byKind('control_insufficient')} control, ${byKind('test_invalidated')} test, ` +
          `${byKind('exception_conflict')} exception, ${byKind('work_stale')} work. ` +
          `Readiness ${now.score}% → ${after.score}% if adopted as written.`,
        changeId: CHANGE_ID,
        findings: findings.map((f) => ({
          id: f.id,
          kind: f.kind,
          severity: f.severity,
          summary: f.summary,
          entityIds: f.entityIds,
          derivation: f.derivation,
        })),
        readiness: { before: now.score, after: after.score, components: after.components },
        _note:
          'Findings are derived, not decided. Nothing here has been written to approved state. ' +
          'Use create_impact_review to bundle these into proposals a human can approve.',
      };
    },
  },

  {
    name: 'detect_gaps',
    title: 'Detect standing gaps',
    description:
      'Find drift that exists right now, with no change proposed: requirements with no implementing ' +
      'control, identity classes a requirement covers that its controls do not, evidence past its ' +
      'freshness window, exceptions expiring or already lapsed, and controls whose coverage overlaps ' +
      'an exception carving out the same class. Use it to answer "where do we stand" and before ' +
      'generating an audit packet. ' +
      'Do NOT use it to evaluate the proposed change — it knows nothing about the change; ' +
      'analyze_change_impact does that.',
    views: ['overview', 'graph', 'execution', 'evidence'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['controls', 'evidence', 'conflicts', 'all'],
          description:
            "'controls' = coverage gaps; 'evidence' = staleness; 'conflicts' = exception expiry and " +
            "overlap. Defaults to 'all'.",
        },
      },
      additionalProperties: false,
    },
    touched: (r) => ((r.findings as { entityIds: string[] }[] | undefined) ?? []).flatMap((f) => f.entityIds),
    execute: ({ scope = 'all' }) => {
      const findings = detectGaps(index(), scope as 'all', today());
      const counts = findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.kind] = (acc[f.kind] ?? 0) + 1;
        return acc;
      }, {});
      return {
        summary: findings.length
          ? `${findings.length} gap(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}.`
          : `No gaps found in scope '${scope}'.`,
        scope,
        counts,
        findings: findings.map((f) => ({
          id: f.id,
          kind: f.kind,
          severity: f.severity,
          summary: f.summary,
          entityIds: f.entityIds,
          derivation: f.derivation,
        })),
      };
    },
  },

  {
    name: 'calculate_readiness',
    title: 'Calculate assurance readiness',
    description:
      'Compute the readiness score with its full breakdown: control coverage, verification, evidence ' +
      'freshness, exception health, and open proposals, each with its weight, sub-score, and the ' +
      'specific reason it is not 100%. The formula is returned with the result. The score is always ' +
      'recomputed from the live graph — approving a fix changes the graph, and the score follows; ' +
      'nothing adds points for activity. ' +
      'Do NOT report the score without its breakdown; a bare number is exactly the false confidence ' +
      'this system exists to prevent.',
    views: ['overview', 'impact', 'evidence'],
    annotations: readOnly,
    inputSchema: noInput,
    execute: () => {
      const r = currentReadiness();
      const worst = [...r.components].sort((a, b) => a.score - b.score)[0];
      return {
        summary:
          `Readiness ${r.score}%. Weakest component: ${worst?.label} at ` +
          `${Math.round((worst?.score ?? 0) * 100)}% — ${worst?.detail}`,
        score: r.score,
        components: r.components,
        formula: r.formula,
      };
    },
  },
];

const proposeTools: ToolDefinition[] = [
  {
    name: 'propose_control',
    title: 'Propose a control or a change to one',
    description:
      'Propose a new control, or a revision to an existing one, in response to a finding. Use ' +
      'targetControlId to revise an existing control and omit it to propose a new one. State the ' +
      'change as `properties` — the machine-comparable configuration you are asking for — so the ' +
      'reviewer sees exactly what would change and the analyzer can re-check it afterwards. ' +
      'When the user pushes back with domain knowledge you did not have (for example that a ' +
      'break-glass path must not depend on the identity provider, because provider failure is the ' +
      'condition it exists for), propose a compensating control that honours their constraint ' +
      'rather than restating the requirement or arguing. ' +
      'Do NOT use this to record that a control is already compliant, and do NOT attempt to apply ' +
      'or approve a change — you cannot; a human approves in the impact review.',
    views: ['impact'],
    annotations: proposing,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "Short imperative title, e.g. 'Require FIDO2 for privileged sessions'." },
        rationale: {
          type: 'string',
          description:
            'Why this is needed, in terms a reviewer can check — reference the finding and the ' +
            'specific mismatch, not a general principle.',
        },
        targetControlId: { type: 'string', description: "Existing control to revise, e.g. 'CTL-114'. Omit for a new control." },
        requirementId: { type: 'string', description: "Requirement this control would serve, e.g. 'AC-2'." },
        properties: {
          type: 'array',
          description: 'The control’s configuration after the change, in the assertion shape used by requirements.',
          items: { type: 'object' },
        },
        coversIdentityClasses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which classes of principal the control would govern.',
        },
        implementationNotes: { type: 'string', description: 'How it would be enforced, and in which system.' },
        derivedFromFindingId: { type: 'string', description: "Finding id this answers, e.g. 'F-004'." },
      },
      required: ['title', 'rationale'],
      additionalProperties: false,
    },
    execute: (input) =>
      queue({
        id: agentProposalId('ctl'),
        kind: input.targetControlId ? 'control_update' : 'control',
        title: String(input.title),
        rationale: String(input.rationale),
        targetEntityId: input.targetControlId ? String(input.targetControlId) : undefined,
        derivedFromFindingId: input.derivedFromFindingId ? String(input.derivedFromFindingId) : undefined,
        payload: {
          requirementId: input.requirementId ?? null,
          properties: input.properties ?? [],
          coversIdentityClasses: input.coversIdentityClasses ?? [],
          implementationNotes: input.implementationNotes ?? null,
        },
        provenance: {
          createdBy: 'agent:webmcp',
          origin: 'agent',
          createdAt: today(),
          rationale: String(input.rationale),
          state: 'proposed',
        },
        status: 'pending',
      }),
  },

  {
    name: 'propose_work_item',
    title: 'Propose engineering work',
    description:
      'Propose a work item for the team that owns the control it serves, with acceptance criteria ' +
      'specific enough to be verifiable. Name the tracker the owning team actually uses — Jira for ' +
      'the core org, Azure Boards for the acquired business unit — rather than assuming one. ' +
      'Do NOT propose work an existing item already covers; check get_execution_state first. Do NOT ' +
      'use this to approve or schedule anything; it queues a draft for a human.',
    views: ['impact', 'execution'],
    annotations: proposing,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What would be done, as an engineer would title it.' },
        rationale: { type: 'string', description: 'Which finding this answers and why this work closes it.' },
        team: {
          type: 'string',
          enum: ['Platform Identity', 'Cloud SRE', 'Developer Experience', 'GRC', 'Gov Cloud'],
          description: 'Owning team. Match the team that owns the control this serves.',
        },
        tracker: {
          type: 'string',
          enum: ['jira', 'azure_boards'],
          description: 'Where it would be filed. The acquired org (Gov Cloud) uses Azure Boards.',
        },
        controlId: { type: 'string', description: "Control this work would fulfill, e.g. 'CTL-114'." },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Verifiable conditions — checkable by a person or a test, not aspirational.',
        },
        derivedFromFindingId: { type: 'string', description: 'Finding id this answers.' },
      },
      required: ['title', 'rationale', 'team', 'acceptanceCriteria'],
      additionalProperties: false,
    },
    execute: (input) =>
      queue({
        id: agentProposalId('wi'),
        kind: 'work_item',
        title: String(input.title),
        rationale: String(input.rationale),
        targetEntityId: input.controlId ? String(input.controlId) : undefined,
        derivedFromFindingId: input.derivedFromFindingId ? String(input.derivedFromFindingId) : undefined,
        payload: {
          team: input.team,
          tracker: input.tracker ?? 'jira',
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          controlId: input.controlId ?? null,
        },
        provenance: {
          createdBy: 'agent:webmcp',
          origin: 'agent',
          createdAt: today(),
          rationale: String(input.rationale),
          state: 'proposed',
        },
        status: 'pending',
      }),
  },

  {
    name: 'propose_trace_link',
    title: 'Propose a traceability link',
    description:
      'Propose an edge between two entities — typically a control to a requirement it in fact ' +
      'implements, or a test to a control it in fact verifies — when the graph is missing a ' +
      'connection the evidence supports. Cite the system of record in supportedByRef. Links you ' +
      'propose enter the graph dashed and unverified until a human confirms them; say so rather ' +
      'than describing the link as established. ' +
      'Do NOT propose a link that already exists, and do NOT use this to assert compliance — an ' +
      'edge records a relationship, not a judgement that it is satisfied.',
    views: ['impact', 'graph'],
    annotations: proposing,
    inputSchema: {
      type: 'object',
      properties: {
        fromId: { type: 'string', description: "Source entity id, e.g. 'CTL-118'." },
        toId: { type: 'string', description: "Target entity id, e.g. 'AC-2'. Requirements are addressed by stable code." },
        type: {
          type: 'string',
          enum: ['implements', 'fulfills', 'verifies', 'evidences', 'excepts', 'documents', 'depends_on'],
          description:
            "'implements' control→requirement, 'fulfills' work→control, 'verifies' test→control, " +
            "'evidences' evidence→control, 'excepts' exception→control, 'depends_on' work→work.",
        },
        rationale: { type: 'string', description: 'Why this relationship holds. A reviewer will check exactly this.' },
        supportedByRef: {
          type: 'string',
          description: "System of record supporting it, as 'system:ref', e.g. 'entra_id:AR-prod-entitlements'.",
        },
        derivedFromFindingId: { type: 'string', description: 'Finding id this answers.' },
      },
      required: ['fromId', 'toId', 'type', 'rationale'],
      additionalProperties: false,
    },
    execute: (input) => {
      const [system, ref] = String(input.supportedByRef ?? '').split(':');
      return queue({
        id: agentProposalId('lnk'),
        kind: 'trace_link',
        title: `${input.type} ${input.fromId} → ${input.toId}`,
        rationale: String(input.rationale),
        targetEntityId: String(input.toId),
        derivedFromFindingId: input.derivedFromFindingId ? String(input.derivedFromFindingId) : undefined,
        payload: { fromId: input.fromId, toId: input.toId, type: input.type },
        provenance: {
          createdBy: 'agent:webmcp',
          origin: 'agent',
          createdAt: today(),
          rationale: String(input.rationale),
          supportedBy: system && ref ? { system: system as SourceRef['system'], ref } : undefined,
          state: 'proposed',
        },
        status: 'pending',
      });
    },
  },

  {
    name: 'create_impact_review',
    title: 'Bundle findings into one reviewable change set',
    description:
      'Convert the findings into individually reviewable draft proposals grouped under one review, ' +
      'each carrying the exact configuration change it asks for and the finding it answers. Call ' +
      'this after analyze_change_impact. The review is where the boundary becomes visible: every ' +
      'item is pending, each is independently approvable, editable and rejectable, and none takes ' +
      'effect until a named person acts. ' +
      'Do NOT describe the review as applied, submitted for processing, or done — it is queued for ' +
      'a person. Do NOT call it twice for the same change; call list-style tools to read it back.',
    views: ['impact'],
    annotations: proposing,
    inputSchema: {
      type: 'object',
      properties: {
        summaryForReviewer: {
          type: 'string',
          description:
            'What the reviewer should understand before they start — including anything you were ' +
            'unsure of, and any constraint they gave you that you have honoured.',
        },
      },
      additionalProperties: false,
    },
    execute: ({ summaryForReviewer }) => {
      const { reviewId, proposals } = createReviewInStore();
      const pending = proposals.filter((p) => p.status === 'pending');
      return {
        summary: `Impact review ${reviewId} created with ${pending.length} proposal(s), all awaiting human review.`,
        reviewId,
        proposals: pending.map((p) => ({
          id: p.id,
          kind: p.kind,
          title: p.title,
          target: p.targetEntityId ?? null,
          derivedFrom: p.derivedFromFindingId ?? null,
          status: p.status,
        })),
        reviewerSummary: summaryForReviewer ?? null,
        _note: PROPOSAL_NOTE,
      };
    },
  },
];

const auditTools: ToolDefinition[] = [
  {
    name: 'explain_trace_link',
    title: 'Explain why a link or a finding exists',
    description:
      'Read back provenance. Given an edge, return who created it, whether a human or an agent did, ' +
      'why they said it holds, which system of record supports it, when a human last confirmed it, ' +
      'and whether it is approved or still proposed. Given a finding id, return the deterministic ' +
      'rule that produced it with the expected and observed assertions and the records compared. ' +
      'Use it when asked how a conclusion was reached, or whether a connection can be trusted. ' +
      'Do NOT infer a rationale when this returns none — say the link is unexplained, because an ' +
      'edge without provenance is a defect worth reporting. Do NOT use it to list a subtree.',
    views: ['impact', 'graph', 'execution', 'evidence'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        edgeId: { type: 'string', description: "Edge id, e.g. 'E-001'." },
        findingId: { type: 'string', description: "Finding id, e.g. 'F-004'." },
        fromId: { type: 'string', description: 'Source entity id, when you do not know the edge id.' },
        toId: { type: 'string', description: 'Target entity id, when you do not know the edge id.' },
      },
      additionalProperties: false,
    },
    touched: (r) => {
      const link = r.link as { from?: string; to?: string } | undefined;
      return link?.from && link?.to ? [link.from, link.to] : ((r.entityIds as string[]) ?? []);
    },
    execute: ({ edgeId, findingId, fromId, toId }) => {
      const i = index();
      if (findingId) {
        const finding = getState().findings.find((f) => f.id === findingId);
        if (!finding) {
          return {
            summary: `No finding '${findingId}'. Run analyze_change_impact first.`,
            availableFindingIds: getState().findings.map((f) => f.id),
          };
        }
        selectEntity(finding.entityIds[0] ?? null);
        return {
          summary: `${finding.id} was produced by rule ${finding.derivation.rule}.`,
          finding: { id: finding.id, kind: finding.kind, severity: finding.severity, summary: finding.summary },
          derivation: finding.derivation,
          entityIds: finding.entityIds,
          citations: [...new Set([...finding.entityIds, ...finding.derivation.comparedEntityIds])]
            .map((id) => i.entities.get(id))
            .filter(Boolean)
            .map((e) => ({ id: e!.id, title: e!.title, source: chip(e!.sourceRef) })),
        };
      }

      const edge = edgeId
        ? i.edges.find((e) => e.id === edgeId)
        : i.edges.find((e) => e.from === fromId && e.to === toId);
      if (!edge) {
        return {
          summary: edgeId
            ? `No edge '${edgeId}' in the graph.`
            : `No edge from '${fromId}' to '${toId}'. That relationship is not recorded.`,
        };
      }
      const p = edge.provenance;
      selectEntity(edge.from);
      return {
        summary:
          `${edge.type} ${edge.from} → ${edge.to}, created by ${p.createdBy} (${p.origin}) on ` +
          `${p.createdAt}, state ${p.state}` +
          (p.lastVerified ? `, last verified ${p.lastVerified}.` : ', never verified by a human.'),
        link: {
          id: edge.id,
          type: edge.type,
          from: edge.from,
          to: edge.to,
          createdBy: p.createdBy,
          origin: p.origin,
          rationale: p.rationale,
          supportedBy: p.supportedBy ? chip(p.supportedBy) : null,
          lastVerified: p.lastVerified ?? null,
          state: p.state,
        },
        trustworthiness:
          p.state === 'proposed'
            ? 'Proposed and not yet approved by a human. Do not rely on it as established.'
            : p.lastVerified
              ? `Approved and confirmed by a human on ${p.lastVerified}.`
              : 'Approved but never re-verified. The rationale stands unchecked.',
      };
    },
  },

  {
    name: 'show_requirement_history',
    title: 'Show a requirement’s version history',
    description:
      'Return every recorded version of a requirement with its effective date, approval status and ' +
      'what changed. Editing a requirement here never overwrites; it appends a version, so this is ' +
      'a complete record rather than a reconstruction. Use it to answer when an obligation changed ' +
      'and what it was before. ' +
      'Do NOT use it to compare against the pending change — compare_requirement_versions does that.',
    views: ['change'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: { requirementId: { type: 'string', description: "Stable code, e.g. 'AC-2'." } },
      required: ['requirementId'],
      additionalProperties: false,
    },
    execute: ({ requirementId }) => {
      const i = index();
      const versions = versionsOf(i, String(requirementId));
      if (!versions.length) return { summary: `No requirement '${requirementId}' on record.` };
      return {
        summary: `${requirementId}: ${versions.length} version(s) on record, current is v${
          currentRequirement(i, String(requirementId))?.version
        }.`,
        versions: versions.map((v) => ({
          version: v.version,
          effectiveDate: v.effectiveDate,
          approvalStatus: v.approvalStatus,
          owner: v.owner,
          applicability: v.applicability,
          obligations: v.assertions.map(describeAssertion),
          changeSummary: v.changeSummary ?? null,
          text: v.text,
        })),
      };
    },
  },

  {
    name: 'generate_traceability_matrix',
    title: 'Generate the traceability matrix',
    description:
      'Produce the requirement-to-evidence matrix an assessor reads: each requirement, the controls ' +
      'implementing it, the tests verifying those controls, the evidence supporting them with ' +
      'freshness, the work in flight, and any exception carving out part of the scope — each row ' +
      'carrying the source-system reference it came from. Rows with nothing in a column are the ' +
      'point of the document, so gaps are rendered explicitly rather than omitted. ' +
      'Do NOT use this to read the graph for your own reasoning; it is formatted for a human ' +
      'assessor and is expensive. Do NOT present it as an audit submission — that is ' +
      'generate_audit_packet.',
    views: ['evidence'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: {
        requirementIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to these requirements. Omit for the whole standard.',
        },
      },
      additionalProperties: false,
    },
    execute: ({ requirementIds }) => {
      const i = index();
      const t = today();
      const wanted = Array.isArray(requirementIds) && requirementIds.length ? (requirementIds as string[]) : null;
      const rows = currentRequirements(i)
        .filter((r) => !wanted || wanted.includes(r.requirementId))
        .map((r) => {
          const controls = controlsFor(i, r.requirementId);
          const tests = controls.flatMap((c) => testsFor(i, c.id));
          const evidence = controls.flatMap((c) => evidenceFor(i, c.id));
          const exceptions = controls.flatMap((c) =>
            edgesTo(i, c.id, 'excepts').map((e) => i.entities.get(e.from)).filter((x) => x?.kind === 'exception'),
          );
          return {
            requirement: `${r.code} v${r.version}`,
            title: r.title,
            risk: r.riskLevel,
            owner: r.owner,
            source: chip(r.sourceRef),
            controls: controls.map((c) => `${c.code} (${chip(c.sourceRef)})`),
            tests: tests.map((x) => `${x.id} [${x.lastResult ?? 'not_run'}] (${chip(x.sourceRef)})`),
            evidence: evidence.map((e) => `${e.id}${isEvidenceStale(e, t) ? ' STALE' : ''} (${chip(e.sourceRef)})`),
            work: controls.flatMap((c) => workItemsFor(i, c.id)).map((w) => `${chip(w.sourceRef)} [${w.status}]`),
            exceptions: exceptions.map((e) => (e?.kind === 'exception' ? `${e.code} exp. ${e.expiresAt}` : '')),
            gaps: [
              controls.length === 0 ? 'no implementing control' : null,
              tests.length === 0 && r.verificationMethod === 'automated_test' ? 'no automated test' : null,
              evidence.some((e) => isEvidenceStale(e, t)) ? 'stale evidence' : null,
            ].filter(Boolean),
          };
        });
      const withGaps = rows.filter((r) => r.gaps.length).length;
      return {
        summary: `Traceability matrix: ${rows.length} requirement(s), ${withGaps} with at least one gap.`,
        generatedAt: t,
        rows,
      };
    },
  },

  {
    name: 'generate_audit_packet',
    title: 'Generate an audit packet',
    description:
      'Assemble the record for an assessor: the requirement before and after, the interpretation ' +
      'that was accepted and who accepted it, affected controls with their source-system references, ' +
      'work approved and work rejected, exception rationale, the named decision-maker for each ' +
      'approval, and the coverage gaps that remain open. Rejected proposals and remaining gaps are ' +
      'included deliberately — a packet showing only what passed is the one an assessor trusts least. ' +
      'Call it after a review has been acted on, so approvals carry names and dates. ' +
      'Do NOT call it to preview what a packet would contain before anyone has decided anything; it ' +
      'will honestly report that nothing was decided.',
    views: ['evidence', 'impact'],
    annotations: readOnly,
    inputSchema: noInput,
    execute: () => {
      const state = getState();
      const i = index();
      const approved = state.proposals.filter((p) => p.status === 'approved' || p.status === 'edited');
      const rejected = state.proposals.filter((p) => p.status === 'rejected');
      const undecided = state.proposals.filter((p) => p.status === 'pending');
      const r = currentReadiness();
      const openGaps = detectGaps(i, 'all', state.today);
      const before = versionsOf(i, 'AC-2').find((v) => v.version === 2);
      const affectedControls = [...new Set(state.findings.flatMap((f) => f.entityIds))]
        .map((id) => i.entities.get(id))
        .filter((e) => e?.kind === 'control');

      return {
        summary:
          `Audit packet for ${CHANGE_ID}: ${approved.length} approved, ${rejected.length} rejected, ` +
          `${undecided.length} undecided, ${openGaps.length} gap(s) remaining, readiness ${r.score}%.`,
        generatedAt: state.today,
        changeId: CHANGE_ID,
        requirement: {
          code: 'AC-2',
          before: before ? { version: before.version, text: before.text, effectiveDate: before.effectiveDate } : null,
          after: { version: proposedRequirement.version, text: proposedRequirement.text, effectiveDate: proposedRequirement.effectiveDate },
          source: 'confluence:WSEC/pages/884215',
        },
        acceptedInterpretation: state.reviewerConstraint
          ? {
              constraint:
                'Break-glass credentials for regional control planes must not depend on the identity ' +
                'provider; provider unavailability is the condition they exist for.',
              raisedBy: 'd.lindqvist@wexler.example',
              resolution:
                'Compensating control accepted in place of factor strength for the break_glass class.',
            }
          : null,
        decisions: approved.map((p) => ({
          proposalId: p.id,
          title: p.title,
          outcome: p.status,
          decidedBy: p.reviewedBy ?? 'unrecorded',
          decidedAt: p.reviewedAt ?? 'unrecorded',
          note: p.reviewNote ?? null,
          rationale: p.rationale,
          proposedBy: p.provenance.createdBy,
        })),
        rejected: rejected.map((p) => ({
          proposalId: p.id,
          title: p.title,
          rejectedBy: p.reviewedBy ?? 'unrecorded',
          reason: p.reviewNote ?? 'no reason recorded',
        })),
        undecided: undecided.map((p) => ({ proposalId: p.id, title: p.title })),
        affectedControls: affectedControls.map((c) =>
          c?.kind === 'control'
            ? { code: c.code, owner: c.owner, enforcedIn: c.enforcedIn.map(chip), source: chip(c.sourceRef) }
            : null,
        ),
        exceptions: allExceptions(i).map((e) => ({
          code: e.code,
          status: e.status,
          approver: e.approver,
          expiresAt: e.expiresAt,
          reason: e.reason,
          source: chip(e.sourceRef),
        })),
        remainingGaps: openGaps.map((f) => ({ severity: f.severity, summary: f.summary, rule: f.derivation.rule })),
        readiness: { score: r.score, components: r.components, formula: r.formula },
      };
    },
  },
];

/** Native-system tools preserve the identifiers and vocabulary of each system of record. */
const enterpriseSourceTools: ToolDefinition[] = [
  {
    name: 'search_confluence_pages',
    title: 'Search Wexler Confluence policy pages',
    description: 'Search the simulated Wexler Confluence space for policy and requirement pages by id, title, or text. Use this to locate policy truth, not delivery work.',
    views: ['overview', 'change', 'impact', 'graph', 'execution', 'evidence'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Policy text, requirement code, page id, or title fragment.' } },
      required: ['query'],
      additionalProperties: false,
    },
    execute: ({ query }) => {
      const q = String(query).toLowerCase();
      const records = recordsFrom(['confluence']).filter((entity) => JSON.stringify(entity).toLowerCase().includes(q));
      return { summary: `Found ${records.length} Confluence page(s) matching '${String(query)}'.`, records: records.map(projectSourceRecord) };
    },
  },
  sourceLookupTool('get_confluence_page', 'Read a Confluence policy page', 'Return one simulated Confluence policy page by its native WSEC page reference. Use it for authoritative policy wording and version metadata.', ['confluence'], 'pageRef', "Native reference such as 'WSEC/pages/884215'."),
  {
    name: 'search_jira_issues',
    title: 'Search Wexler Jira issues',
    description: 'Search simulated Jira work by key, title, team, assignee, status, or acceptance criteria. Use it to find engineering work connected to a policy obligation.',
    views: ['overview', 'change', 'impact', 'graph', 'execution', 'evidence'],
    annotations: readOnly,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: "Jira key or free-text query, e.g. 'PLAT-4471' or 'break glass'." } },
      required: ['query'],
      additionalProperties: false,
    },
    execute: ({ query }) => {
      const q = String(query).toLowerCase();
      const records = recordsFrom(['jira']).filter((entity) => JSON.stringify(entity).toLowerCase().includes(q));
      return { summary: `Found ${records.length} Jira issue(s) matching '${String(query)}'.`, records: records.map(projectSourceRecord) };
    },
  },
  sourceLookupTool('get_jira_issue', 'Read a Jira issue', 'Return one simulated Jira issue with status, owner, acceptance criteria, and trace identity. Use this after search_jira_issues identifies a key.', ['jira'], 'issueKey', "Native Jira key such as 'PLAT-4471'."),
  sourceLookupTool('get_azure_board_item', 'Read an Azure Boards work item', 'Return one simulated Azure Boards record from the acquired business unit. Use this instead of get_jira_issue for numeric Azure work-item ids.', ['azure_boards'], 'workItemId', "Native numeric id such as '12844'."),
  sourceLookupTool('get_pipeline_run', 'Read an automated test or pipeline run', 'Return a simulated GitHub Actions or Azure DevOps Pipelines test definition or run. Use this to verify implementation evidence, not policy intent.', ['github_actions', 'azure_pipelines'], 'runRef', 'Native workflow, run, or pipeline reference.'),
  sourceLookupTool('get_identity_record', 'Read an Entra ID or Okta identity record', 'Return a simulated Microsoft Entra ID or Okta configuration or export. Use this to inspect identity enforcement across corporate and acquired environments.', ['entra_id', 'okta'], 'recordRef', 'Native Entra export or Okta report reference.'),
  sourceLookupTool('get_servicenow_exception', 'Read a ServiceNow exception', 'Return one simulated ServiceNow risk exception or approval record. This reads scope, approver, expiry, and rationale; it cannot approve or renew it.', ['servicenow'], 'ticket', "Native request id such as 'RITM0084412'."),
  sourceLookupTool('get_vanta_control_status', 'Read a Vanta monitor record', 'Return a simulated Vanta continuous-compliance monitor or evidence record. Use it to reconcile reported compliance with technical evidence.', ['vanta'], 'monitorRef', 'Native Vanta monitor reference.'),
  sourceLookupTool('get_architecture_decision', 'Read a SharePoint architecture decision', 'Return a simulated SharePoint ADR explaining an architectural constraint or accepted design.', ['sharepoint'], 'decisionRef', 'Native SharePoint ADR reference.'),
  sourceLookupTool('get_infrastructure_record', 'Read an infrastructure execution record', 'Return a simulated AWS, Azure, or Terraform Cloud infrastructure record tied to a control.', ['aws', 'azure', 'terraform_cloud'], 'recordRef', 'Native cloud resource or Terraform run reference.'),
  sourceLookupTool('get_observability_record', 'Read a Splunk or Datadog record', 'Return a simulated Splunk or Datadog logging, retention, drift, or monitoring record.', ['splunk', 'datadog'], 'recordRef', 'Native Splunk or Datadog record reference.'),
];

export const ALL_TOOLS: ToolDefinition[] = [
  ...readTools,
  ...enterpriseSourceTools,
  ...analyzeTools,
  ...proposeTools,
  ...auditTools,
];

export const TOOL_GROUPS = {
  read: readTools.map((t) => t.name),
  enterprise: enterpriseSourceTools.map((t) => t.name),
  analyze: analyzeTools.map((t) => t.name),
  propose: proposeTools.map((t) => t.name),
  audit: auditTools.map((t) => t.name),
} as const;

export function toolsForView(view: ViewId): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => tool.annotations.readOnlyHint || tool.views.includes(view));
}

export function toolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/** Exposed so the UI can offer the reviewer's push-back as a first-class action. */
export { applyReviewerConstraint, logActivity };
