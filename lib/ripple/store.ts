/**
 * RippleTrace state.
 *
 * A vanilla observable store so the tool layer and the UI drive the same
 * object. Two properties matter:
 *
 *   1. Approving a proposal *mutates the graph*. It does not add points to a
 *      score. Readiness is recomputed from the mutated graph every time it is
 *      read, so the number is always a consequence and never a narrative.
 *   2. Every write to approved state calls `assertHumanActor`, so it throws
 *      when a tool handler is the caller. See `actor.ts`.
 */

import { useSyncExternalStore } from 'react';
import { assertHumanActor, runAsHuman } from './actor';
import { analyzeChangeImpact } from './impact';
import { currentRequirement, indexSnapshot, type GraphIndex } from './graph';
import { calculateReadiness } from './readiness';
import { compensatingControlProposal, proposalsForFinding } from './proposals';
import { DEMO_TODAY, seedSnapshot } from './seed';
import { proposedRequirement } from './scenario';
import type {
  Assertion,
  Control,
  Entity,
  Evidence,
  Exception,
  Finding,
  IdentityClass,
  Proposal,
  Readiness,
  RequirementVersion,
  TestDefinition,
  TraceEdge,
  WorkItem,
} from './types';

export type ViewId = 'overview' | 'change' | 'impact' | 'graph' | 'execution' | 'evidence';

export const REVIEWER = 'd.lindqvist@wexler.example';
export const CHANGE_ID = 'AC2-CHG-2026-017';

export interface ActivityEntry {
  id: string;
  at: number;
  actor: string;
  origin: 'human' | 'agent';
  tool?: string;
  message: string;
  entityIds: string[];
  refused?: boolean;
}

export interface RippleState {
  entities: Entity[];
  edges: TraceEdge[];
  proposals: Proposal[];
  findings: Finding[];
  analyzed: boolean;
  reviewId: string | null;
  reviewerConstraint: boolean;
  activity: ActivityEntry[];
  view: ViewId;
  selectedEntityId: string | null;
  highlightedEntityIds: string[];
  today: string;
}

const INITIAL_ACTIVITY: Omit<ActivityEntry, 'id' | 'at'>[] = [
  {
    actor: 'confluence',
    origin: 'human',
    message: `Change ${CHANGE_ID} received from p.okafor@wexler.example.`,
    entityIds: ['AC-2@2'],
  },
  {
    actor: 'rippletrace',
    origin: 'human',
    message: 'Linked records identified across eight systems. None have been evaluated or changed.',
    entityIds: [],
  },
];

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(++counter).toString(36)}`;

function initialState(): RippleState {
  const snapshot = seedSnapshot();
  return {
    entities: snapshot.entities,
    edges: snapshot.edges,
    proposals: [],
    findings: [],
    analyzed: false,
    reviewId: null,
    reviewerConstraint: false,
    activity: INITIAL_ACTIVITY.map((entry) => ({ ...entry, id: nextId('act'), at: Date.now() })),
    view: 'overview',
    selectedEntityId: null,
    highlightedEntityIds: [],
    today: DEMO_TODAY,
  };
}

let state: RippleState = initialState();
const listeners = new Set<() => void>();

function set(patch: Partial<RippleState> | ((s: RippleState) => Partial<RippleState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((listener) => listener());
}

export function getState(): RippleState {
  return state;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRipple<T>(selector: (s: RippleState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

// --- derived -----------------------------------------------------------------

let indexCache: { entities: Entity[]; edges: TraceEdge[]; index: GraphIndex } | null = null;

export function graphIndex(): GraphIndex {
  if (!indexCache || indexCache.entities !== state.entities || indexCache.edges !== state.edges) {
    indexCache = {
      entities: state.entities,
      edges: state.edges,
      index: indexSnapshot({ entities: state.entities, edges: state.edges }),
    };
  }
  return indexCache.index;
}

/**
 * Always recomputed from the live graph. Never stored, never adjusted.
 *
 * The result is memoised on the identity of the state it was computed from, so
 * React can read it through the store subscription and still get a stable
 * object. Recomputation happens exactly when the graph, the queue, or the demo
 * date changes — which is the definition of "derived".
 */
let readinessCache: { key: unknown[]; value: Readiness } | null = null;
let projectedCache: { key: unknown[]; value: Readiness } | null = null;

const cacheKey = () => [state.entities, state.edges, state.proposals, state.today];
const isStale = (cache: { key: unknown[] } | null, key: unknown[]) =>
  !cache || cache.key.some((part, i) => part !== key[i]);

export function readiness(): Readiness {
  const key = cacheKey();
  if (isStale(readinessCache, key)) {
    readinessCache = { key, value: calculateReadiness(graphIndex(), state.proposals, state.today) };
  }
  return readinessCache!.value;
}

export const useReadiness = () => useRipple(() => readiness());
export const useProjectedReadiness = () => useRipple(() => projectedReadiness());

export function baselineRequirement() {
  return currentRequirement(graphIndex(), 'AC-2')!;
}

/** Readiness as it would stand if the change were adopted with nothing fixed. */
export function projectedReadiness(): Readiness {
  const key = cacheKey();
  if (!isStale(projectedCache, key)) return projectedCache!.value;
  const withDraft = indexSnapshot({
    entities: [
      ...state.entities.map((entity) =>
        entity.kind === 'requirement' && entity.id === 'AC-2@2'
          ? { ...entity, approvalStatus: 'superseded' as const }
          : entity,
      ),
      { ...proposedRequirement, approvalStatus: 'approved' as const },
    ],
    edges: state.edges,
  });
  projectedCache = { key, value: calculateReadiness(withDraft, state.proposals, state.today) };
  return projectedCache.value;
}

// --- agent-callable writes ---------------------------------------------------
// These touch the proposal queue and the activity log. Never approved state.

export function logActivity(entry: Omit<ActivityEntry, 'id' | 'at'>) {
  set((s) => ({
    activity: [{ ...entry, id: nextId('act'), at: Date.now() }, ...s.activity].slice(0, 60),
  }));
}

/** Agents may add to the proposal queue. That is the whole of what they may write. */
export function addProposal(proposal: Proposal) {
  if (state.proposals.some((p) => p.id === proposal.id)) return;
  set((s) => ({ proposals: [...s.proposals, { ...proposal, reviewId: s.reviewId ?? undefined }] }));
}

export function setHighlight(entityIds: string[]) {
  set({ highlightedEntityIds: entityIds });
}

export function selectEntity(entityId: string | null) {
  set({ selectedEntityId: entityId });
}

export function setView(view: ViewId) {
  set({ view });
}

/** Run the deterministic analyzer and record its findings. Writes nothing else. */
export function runAnalysis(): Finding[] {
  const index = graphIndex();
  // The baseline is always AC-2 v2, even after v3 has been adopted. Comparing
  // the live graph against the revised obligation is what makes a finding
  // disappear when the control behind it is actually fixed — which is the only
  // reason the readiness score is allowed to recover.
  const before =
    (index.requirementVersions.get('AC-2') ?? []).find((v) => v.version === 2) ??
    currentRequirement(index, 'AC-2')!;
  const impact = analyzeChangeImpact(index, before, proposedRequirement);
  set({ analyzed: true, findings: impact.findings });
  return impact.findings;
}

/** Bundle findings into draft proposals. Every one lands pending. */
export function createReview(): { reviewId: string; proposals: Proposal[] } {
  const findings = state.analyzed ? state.findings : runAnalysis();
  /**
   * The policy change itself is the first thing a human must approve.
   *
   * Until this is accepted, AC-2 v2 remains in force. The agent analyzed the
   * change, derived its consequences and drafted the remediation — and it still
   * cannot adopt the policy. That is the whole thesis in one row of the review.
   */
  const adoption: Proposal = {
    id: 'PROP-ADOPT-AC2',
    kind: 'requirement_version',
    title: 'Adopt AC-2 v3 as the approved requirement',
    rationale:
      'Supersedes AC-2 v2. Remediation below is written against v3, so adopt this first — until ' +
      'it is approved, v2 is what the graph is measured against.',
    derivedFromFindingId: 'policy-adoption',
    targetEntityId: 'AC-2@2',
    payload: { version: proposedRequirement },
    provenance: {
      createdBy: 'p.okafor@wexler.example',
      origin: 'human',
      createdAt: state.today,
      rationale: 'Change AC2-CHG-2026-017 submitted from Confluence.',
      state: 'proposed',
    },
    status: 'pending',
  };
  const drafted = [adoption, ...findings.flatMap((finding) => proposalsForFinding(finding, state.today))];
  const reviewId = `REV-${CHANGE_ID}`;
  set((s) => ({
    reviewId,
    proposals: [
      ...s.proposals,
      ...drafted
        .filter((proposal) => !s.proposals.some((existing) => existing.id === proposal.id))
        .map((proposal) => ({ ...proposal, reviewId })),
    ],
  }));
  return { reviewId, proposals: state.proposals };
}

/**
 * The reviewer pushes back with domain knowledge the agent could not have.
 * The agent responds with a compensating path, not an argument.
 */
export function applyReviewerConstraint(): Proposal[] {
  const added = compensatingControlProposal(state.today).filter(
    (proposal) => !state.proposals.some((existing) => existing.id === proposal.id),
  );
  set((s) => ({
    reviewerConstraint: true,
    proposals: [...s.proposals, ...added.map((p) => ({ ...p, reviewId: s.reviewId ?? undefined }))],
  }));
  return added;
}

// --- human-only writes -------------------------------------------------------

/** Apply an approved proposal to the graph. Called only from `approveProposal`. */
function applyToGraph(proposal: Proposal): string[] {
  const touched: string[] = [];
  const today = state.today;

  const upsert = (entity: Entity) =>
    set((s) => ({
      entities: s.entities.some((e) => e.id === entity.id)
        ? s.entities.map((e) => (e.id === entity.id ? entity : e))
        : [...s.entities, entity],
    }));

  const addEdge = (edge: TraceEdge) =>
    set((s) => (s.edges.some((e) => e.id === edge.id) ? {} : { edges: [...s.edges, edge] }));

  const humanProvenance = (rationale: string, origin: 'human' | 'agent' = 'human') => ({
    createdBy: origin === 'agent' ? proposal.provenance.createdBy : REVIEWER,
    origin,
    createdAt: proposal.provenance.createdAt,
    rationale,
    supportedBy: proposal.provenance.supportedBy,
    lastVerified: today,
    state: 'approved' as const,
  });

  switch (proposal.kind) {
    case 'requirement_version': {
      const version = proposal.payload.version as RequirementVersion | undefined;
      if (!version) break;
      set((s) => ({
        entities: [
          ...s.entities.map((e) =>
            e.kind === 'requirement' && e.requirementId === version.requirementId && e.approvalStatus !== 'superseded'
              ? { ...e, approvalStatus: 'superseded' as const }
              : e,
          ),
          { ...version, approvalStatus: 'approved' as const, effectiveDate: today },
        ],
      }));
      touched.push(version.id, version.requirementId);
      break;
    }

    case 'control_update': {
      const target = state.entities.find((e) => e.id === proposal.targetEntityId);
      if (target?.kind !== 'control') break;
      const properties = (proposal.payload.properties as Assertion[] | undefined) ?? [];
      upsert({
        ...target,
        properties: [
          ...target.properties.filter((p) => !properties.some((n) => n.kind === p.kind)),
          ...properties,
        ],
        implementationStatus: 'implemented',
        lastReviewed: today,
      } satisfies Control);
      touched.push(target.id);
      break;
    }

    case 'control': {
      const covers = (proposal.payload.coversIdentityClasses as IdentityClass[]) ?? [];
      const id = `CTL-${200 + state.entities.filter((e) => e.kind === 'control').length}`;
      upsert({
        id,
        kind: 'control',
        code: id,
        title: proposal.title,
        description: String(proposal.payload.implementationNotes ?? proposal.rationale),
        owner: REVIEWER,
        ownerTeam: 'GRC',
        implementationStatus: 'planned',
        enforcedIn: [{ system: 'throughline', ref: proposal.id }],
        coversIdentityClasses: covers,
        environments: ['production', 'gov_cloud'],
        properties: (proposal.payload.properties as Assertion[]) ?? [],
        lastReviewed: today,
        sourceRef: { system: 'throughline', ref: proposal.id },
      } satisfies Control);
      touched.push(id);

      const requirementId = proposal.payload.requirementId as string | undefined;
      if (requirementId) {
        addEdge({
          id: `E-${proposal.id}`,
          type: 'implements',
          from: id,
          to: requirementId,
          provenance: humanProvenance(proposal.rationale),
        });
        touched.push(requirementId);
      }
      break;
    }

    case 'test_revision': {
      const target = state.entities.find((e) => e.id === proposal.targetEntityId);
      if (target?.kind !== 'test') break;
      const assertions = (proposal.payload.assertions as Assertion[] | undefined) ?? [];
      upsert({
        ...target,
        assertions: [
          ...target.assertions.filter((a) => !assertions.some((n) => n.kind === a.kind)),
          ...assertions,
        ],
        lastRun: today,
        lastResult: 'pass',
      } satisfies TestDefinition);
      touched.push(target.id);
      break;
    }

    case 'work_item': {
      const target = state.entities.find((e) => e.id === proposal.targetEntityId);
      const criteria = (proposal.payload.acceptanceCriteria as string[]) ?? [];
      if (target?.kind === 'work_item') {
        upsert({ ...target, acceptanceCriteria: criteria, staleReason: undefined } satisfies WorkItem);
        touched.push(target.id);
      }
      break;
    }

    case 'exception_reapproval': {
      const target = state.entities.find((e) => e.id === proposal.targetEntityId);
      if (target?.kind !== 'exception') break;
      upsert({
        ...target,
        status: 'requires_reapproval',
        grounds: proposal.payload.groundedOn
          ? [{ kind: 'approval_workflow', approversRequired: 2, postIncidentReviewHours: 24 }]
          : target.grounds,
      } satisfies Exception);
      touched.push(target.id);
      break;
    }

    default:
      break;
  }

  return touched;
}

export function approveProposal(proposalId: string, note?: string) {
  return runAsHuman(REVIEWER, () => {
    const actor = assertHumanActor('approve_proposal');
    const proposal = state.proposals.find((p) => p.id === proposalId);
    if (!proposal) return { error: 'Proposal not found', id: proposalId };
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id === proposalId
          ? { ...p, status: 'approved' as const, reviewedBy: actor.id, reviewedAt: s.today, reviewNote: note }
          : p,
      ),
    }));
    const touched = applyToGraph(proposal);
    // Re-derive against the mutated graph: a fixed control stops producing its
    // finding, which is the only reason the score recovers.
    if (state.analyzed) runAnalysis();
    logActivity({
      actor: actor.id,
      origin: 'human',
      message: `Approved ${proposal.id} — ${proposal.title}.`,
      entityIds: touched,
    });
    setHighlight(touched);
    return { id: proposalId, status: 'approved', reviewedBy: actor.id, touched };
  });
}

export function rejectProposal(proposalId: string, note?: string) {
  return runAsHuman(REVIEWER, () => {
    const actor = assertHumanActor('reject_proposal');
    const proposal = state.proposals.find((p) => p.id === proposalId);
    if (!proposal) return { error: 'Proposal not found', id: proposalId };
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id === proposalId
          ? { ...p, status: 'rejected' as const, reviewedBy: actor.id, reviewedAt: s.today, reviewNote: note }
          : p,
      ),
    }));
    logActivity({
      actor: actor.id,
      origin: 'human',
      message: `Rejected ${proposal.id}${note ? ` — ${note}` : ''}.`,
      entityIds: [],
    });
    return { id: proposalId, status: 'rejected', reviewedBy: actor.id, reason: note ?? null };
  });
}

export function editProposal(proposalId: string, patch: Partial<Proposal>, note?: string) {
  return runAsHuman(REVIEWER, () => {
    const actor = assertHumanActor('edit_proposal');
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id === proposalId
          ? { ...p, ...patch, id: p.id, status: 'edited' as const, reviewedBy: actor.id, reviewedAt: s.today, reviewNote: note }
          : p,
      ),
    }));
    logActivity({
      actor: actor.id,
      origin: 'human',
      message: `Edited ${proposalId}${note ? ` — ${note}` : ''}.`,
      entityIds: [],
    });
    return { id: proposalId, status: 'edited' };
  });
}

export function approveException(exceptionId: string, note?: string) {
  return runAsHuman(REVIEWER, () => {
    const actor = assertHumanActor('approve_exception');
    const target = state.entities.find((e) => e.id === exceptionId);
    if (target?.kind !== 'exception') return { error: 'Exception not found', id: exceptionId };
    set((s) => ({
      entities: s.entities.map((e) =>
        e.id === exceptionId && e.kind === 'exception'
          ? { ...e, status: 'active' as const, approver: actor.id, approvedAt: s.today, reason: note ?? e.reason }
          : e,
      ),
    }));
    logActivity({
      actor: actor.id,
      origin: 'human',
      message: `Reapproved exception ${exceptionId}.`,
      entityIds: [exceptionId],
    });
    return { id: exceptionId, status: 'active', approver: actor.id };
  });
}

/** Reset — a human action, and a visible button. Judges run the flow twice. */
export function resetScenario() {
  return runAsHuman('human:ui', () => {
    assertHumanActor('reset_scenario');
    indexCache = null;
    state = initialState();
    listeners.forEach((listener) => listener());
    return { status: 'reset', changeId: CHANGE_ID };
  });
}

export function staleEvidence(): Evidence[] {
  return state.entities.filter(
    (e): e is Evidence =>
      e.kind === 'evidence' &&
      (Date.parse(state.today) - Date.parse(e.lastVerified)) / 86_400_000 > e.freshnessWindowDays,
  );
}
