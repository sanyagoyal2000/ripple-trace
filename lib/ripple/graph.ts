/**
 * Graph indexing and traversal.
 *
 * Requirements are versioned, so edges address a requirement by its stable
 * `requirementId` ("AC-2"), never by version id ("AC-2@2"). Resolving the
 * current version is this module's job, and it is the reason a new version
 * never orphans the subtree beneath it.
 */

import { DEMO_TODAY } from "./seed";
import type {
  Control,
  EdgeType,
  Entity,
  Evidence,
  Exception,
  GraphSnapshot,
  IdentityClass,
  IsoDate,
  RequirementVersion,
  TestDefinition,
  TraceEdge,
  WorkItem,
} from "./types";

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export function ageInDays(date: IsoDate, today: IsoDate = DEMO_TODAY): number {
  return daysBetween(date, today);
}

export interface GraphIndex {
  entities: Map<string, Entity>;
  edges: TraceEdge[];
  /** requirementId -> versions, ascending. */
  requirementVersions: Map<string, RequirementVersion[]>;
  outgoing: Map<string, TraceEdge[]>;
  incoming: Map<string, TraceEdge[]>;
}

export function indexSnapshot(snapshot: GraphSnapshot): GraphIndex {
  const entities = new Map<string, Entity>();
  const requirementVersions = new Map<string, RequirementVersion[]>();
  for (const entity of snapshot.entities) {
    entities.set(entity.id, entity);
    if (entity.kind === "requirement") {
      const list = requirementVersions.get(entity.requirementId) ?? [];
      list.push(entity);
      requirementVersions.set(entity.requirementId, list);
    }
  }
  for (const list of requirementVersions.values()) list.sort((a, b) => a.version - b.version);

  const outgoing = new Map<string, TraceEdge[]>();
  const incoming = new Map<string, TraceEdge[]>();
  for (const edge of snapshot.edges) {
    (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from)!).push(edge);
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge);
  }
  return { entities, edges: snapshot.edges, requirementVersions, outgoing, incoming };
}

// --- version resolution ----------------------------------------------------

export function versionsOf(index: GraphIndex, requirementId: string): RequirementVersion[] {
  return index.requirementVersions.get(requirementId) ?? [];
}

/** The highest-numbered version that has not been superseded. */
export function currentRequirement(
  index: GraphIndex,
  requirementId: string,
): RequirementVersion | undefined {
  const versions = versionsOf(index, requirementId);
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i]!;
    if (v.approvalStatus !== "superseded") return v;
  }
  return versions[versions.length - 1];
}

export function requirementAt(
  index: GraphIndex,
  requirementId: string,
  version: number,
): RequirementVersion | undefined {
  return versionsOf(index, requirementId).find((v) => v.version === version);
}

export function currentRequirements(index: GraphIndex): RequirementVersion[] {
  return [...index.requirementVersions.keys()]
    .map((id) => currentRequirement(index, id))
    .filter((r): r is RequirementVersion => Boolean(r));
}

// --- typed accessors -------------------------------------------------------

function entitiesOfKind<K extends Entity["kind"]>(
  index: GraphIndex,
  kind: K,
): Extract<Entity, { kind: K }>[] {
  const out: Extract<Entity, { kind: K }>[] = [];
  for (const e of index.entities.values()) {
    if (e.kind === kind) out.push(e as Extract<Entity, { kind: K }>);
  }
  return out;
}

export const allControls = (i: GraphIndex): Control[] => entitiesOfKind(i, "control");
export const allWorkItems = (i: GraphIndex): WorkItem[] => entitiesOfKind(i, "work_item");
export const allTests = (i: GraphIndex): TestDefinition[] => entitiesOfKind(i, "test");
export const allEvidence = (i: GraphIndex): Evidence[] => entitiesOfKind(i, "evidence");
export const allExceptions = (i: GraphIndex): Exception[] => entitiesOfKind(i, "exception");

// --- traversal -------------------------------------------------------------

export function edgesFrom(index: GraphIndex, id: string, type?: EdgeType): TraceEdge[] {
  const list = index.outgoing.get(id) ?? [];
  return type ? list.filter((e) => e.type === type) : list;
}

export function edgesTo(index: GraphIndex, id: string, type?: EdgeType): TraceEdge[] {
  const list = index.incoming.get(id) ?? [];
  return type ? list.filter((e) => e.type === type) : list;
}

/** Controls linked to a requirement by an approved `implements` edge. */
export function controlsFor(
  index: GraphIndex,
  requirementId: string,
  opts: { includeProposed?: boolean } = {},
): Control[] {
  return edgesTo(index, requirementId, "implements")
    .filter((e) => opts.includeProposed || e.provenance.state === "approved")
    .map((e) => index.entities.get(e.from))
    .filter((e): e is Control => e?.kind === "control");
}

export function testsFor(index: GraphIndex, controlId: string): TestDefinition[] {
  return edgesTo(index, controlId, "verifies")
    .filter((e) => e.provenance.state === "approved")
    .map((e) => index.entities.get(e.from))
    .filter((e): e is TestDefinition => e?.kind === "test");
}

export function evidenceFor(index: GraphIndex, targetId: string): Evidence[] {
  return edgesTo(index, targetId, "evidences")
    .map((e) => index.entities.get(e.from))
    .filter((e): e is Evidence => e?.kind === "evidence");
}

export function workItemsFor(index: GraphIndex, controlId: string): WorkItem[] {
  return edgesTo(index, controlId, "fulfills")
    .map((e) => index.entities.get(e.from))
    .filter((e): e is WorkItem => e?.kind === "work_item");
}

export function exceptionsFor(index: GraphIndex, controlId: string): Exception[] {
  return edgesTo(index, controlId, "excepts")
    .map((e) => index.entities.get(e.from))
    .filter((e): e is Exception => e?.kind === "exception");
}

/** Work items reachable from a requirement through its controls. */
export function workItemsForRequirement(index: GraphIndex, requirementId: string): WorkItem[] {
  const seen = new Map<string, WorkItem>();
  for (const control of controlsFor(index, requirementId, { includeProposed: true })) {
    for (const item of workItemsFor(index, control.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

// --- health predicates -----------------------------------------------------

export function isEvidenceStale(evidence: Evidence, today: IsoDate = DEMO_TODAY): boolean {
  return ageInDays(evidence.lastVerified, today) > evidence.freshnessWindowDays;
}

/**
 * Freshness credit for one evidence item: full credit inside the window, then
 * a linear decay that reaches zero at 1.25x the window. Steep enough that a
 * lapsed sign-off actually shows up in the score.
 */
export function evidenceFreshnessCredit(evidence: Evidence, today: IsoDate = DEMO_TODAY): number {
  const age = ageInDays(evidence.lastVerified, today);
  const overdue = age - evidence.freshnessWindowDays;
  if (overdue <= 0) return 1;
  return Math.max(0, 1 - overdue / (evidence.freshnessWindowDays * 0.25));
}

export const EXCEPTION_EXPIRY_WARNING_DAYS = 30;

export function isExceptionExpiringSoon(
  exception: Exception,
  today: IsoDate = DEMO_TODAY,
): boolean {
  const remaining = daysBetween(today, exception.expiresAt);
  return remaining >= 0 && remaining <= EXCEPTION_EXPIRY_WARNING_DAYS;
}

/** An edge a human has never confirmed, or that is still only proposed. */
export function isUnverifiedLink(edge: TraceEdge): boolean {
  return edge.provenance.state === "proposed" || !edge.provenance.lastVerified;
}

/** Identity classes that any entity in the graph actually covers today. */
export function identityClassesPresent(index: GraphIndex): Set<IdentityClass> {
  const present = new Set<IdentityClass>();
  for (const control of allControls(index)) {
    for (const c of control.coversIdentityClasses) present.add(c);
  }
  for (const exception of allExceptions(index)) {
    for (const c of exception.appliesTo) present.add(c);
  }
  for (const requirement of currentRequirements(index)) {
    for (const c of requirement.applicability) present.add(c);
  }
  return present;
}
