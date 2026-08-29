/**
 * The impact engine.
 *
 * Everything here is a deterministic function of the graph. There is no model
 * call, no heuristic over prose, and no hardcoded finding. Findings are derived
 * by comparing `Assertion` objects — a requirement's demands against a control's
 * configured properties, a test's actual checks, or an exception's granted
 * relief — and every finding carries the comparison that produced it, so
 * `explain_trace_link` can show its work.
 *
 * The one thing the agent contributes is translation: turning "must use
 * phishing-resistant authentication, reviewed every 90 days" into
 * `{ kind: "auth_factor_policy", requirePhishingResistant: true }` and
 * `{ kind: "review_cadence", intervalDays: 90 }`. That is language work, which
 * is what a model is for. The consequences are computed here, which is what a
 * program is for.
 */

import {
  allControls as allControlsIn,
  allExceptions,
  controlsFor,
  currentRequirement,
  edgesFrom,
  edgesTo,
  exceptionsFor,
  identityClassesPresent,
  testsFor,
  workItemsFor,
  type GraphIndex,
} from "./graph";
import type {
  Assertion,
  AuthFactor,
  Control,
  Derivation,
  Finding,
  IdentityClass,
  RequirementVersion,
  Severity,
  TestDefinition,
} from "./types";
import { PHISHING_RESISTANT_FACTORS } from "./types";

// ---------------------------------------------------------------------------
// Assertion satisfaction — the single comparison primitive
// ---------------------------------------------------------------------------

export interface SatisfactionResult {
  satisfied: boolean;
  expected: string;
  observed: string;
}

const list = (xs: readonly string[]) => (xs.length ? xs.join(", ") : "none");

function isPhishingResistant(factor: AuthFactor): boolean {
  return PHISHING_RESISTANT_FACTORS.includes(factor);
}

/**
 * Does `candidate` (a control property, test check, or exception's grounds)
 * satisfy `required` (a requirement's assertion)?
 *
 * The asymmetry matters: a requirement states a bound, and the candidate must
 * fall inside it. Cadences must be no longer, retention no shorter.
 */
export function satisfies(required: Assertion, candidate: Assertion): SatisfactionResult {
  if (required.kind !== candidate.kind) {
    return {
      satisfied: false,
      expected: `an assertion of kind ${required.kind}`,
      observed: `kind ${candidate.kind}`,
    };
  }

  switch (required.kind) {
    case "auth_factor_policy": {
      const c = candidate as Extract<Assertion, { kind: "auth_factor_policy" }>;
      if (required.requirePhishingResistant) {
        const weak = c.permittedFactors.filter((f) => !isPhishingResistant(f));
        const expected = "only phishing-resistant factors permitted, with no fallback";
        if (weak.length) {
          return {
            satisfied: false,
            expected,
            observed: `permits ${list(weak)}, which ${weak.length === 1 ? "is" : "are"} not phishing-resistant`,
          };
        }
        if (c.allowsFallback) {
          return { satisfied: false, expected, observed: "permits fallback to a weaker factor" };
        }
        return { satisfied: true, expected, observed: `permits only ${list(c.permittedFactors)}` };
      }
      const disallowed = c.permittedFactors.filter((f) => !required.permittedFactors.includes(f));
      return {
        satisfied: disallowed.length === 0,
        expected: `permitted factors within {${list(required.permittedFactors)}}`,
        observed: disallowed.length ? `also permits ${list(disallowed)}` : `permits ${list(c.permittedFactors)}`,
      };
    }

    case "review_cadence": {
      const c = candidate as Extract<Assertion, { kind: "review_cadence" }>;
      return {
        satisfied: c.intervalDays <= required.intervalDays,
        expected: `review interval of at most ${required.intervalDays} days`,
        observed: `configured every ${c.intervalDays} days`,
      };
    }

    case "log_retention": {
      const c = candidate as Extract<Assertion, { kind: "log_retention" }>;
      const longEnough = c.retentionDays >= required.retentionDays;
      const immutableEnough = !required.immutable || Boolean(c.immutable);
      return {
        satisfied: longEnough && immutableEnough,
        expected: `at least ${required.retentionDays} days${required.immutable ? ", immutable" : ""}`,
        observed: `${c.retentionDays} days${c.immutable ? ", immutable" : ", mutable"}`,
      };
    }

    case "credential_rotation": {
      const c = candidate as Extract<Assertion, { kind: "credential_rotation" }>;
      return {
        satisfied: c.maxAgeDays <= required.maxAgeDays,
        expected: `credential lifetime of at most ${required.maxAgeDays} days`,
        observed: `lifetime of ${c.maxAgeDays} days`,
      };
    }

    case "scan_cadence": {
      const c = candidate as Extract<Assertion, { kind: "scan_cadence" }>;
      return {
        satisfied: c.intervalDays <= required.intervalDays,
        expected: `scan at least every ${required.intervalDays} days`,
        observed: `scans every ${c.intervalDays} days`,
      };
    }

    case "approval_workflow": {
      const c = candidate as Extract<Assertion, { kind: "approval_workflow" }>;
      const approvers = c.approversRequired >= required.approversRequired;
      const review =
        required.postIncidentReviewHours === undefined ||
        (c.postIncidentReviewHours !== undefined &&
          c.postIncidentReviewHours <= required.postIncidentReviewHours);
      return {
        satisfied: approvers && review,
        expected:
          `${required.approversRequired} approver(s)` +
          (required.postIncidentReviewHours ? `, review within ${required.postIncidentReviewHours}h` : ""),
        observed:
          `${c.approversRequired} approver(s)` +
          (c.postIncidentReviewHours ? `, review within ${c.postIncidentReviewHours}h` : ", no review window"),
      };
    }

    case "monitoring_alert": {
      const c = candidate as Extract<Assertion, { kind: "monitoring_alert" }>;
      const dest = c.destination === required.destination;
      const latency =
        required.maxLatencyMinutes === undefined ||
        (c.maxLatencyMinutes !== undefined && c.maxLatencyMinutes <= required.maxLatencyMinutes);
      return {
        satisfied: dest && latency,
        expected: `alert to ${required.destination}${required.maxLatencyMinutes ? ` within ${required.maxLatencyMinutes}m` : ""}`,
        observed: `alerts to ${c.destination}${c.maxLatencyMinutes ? ` within ${c.maxLatencyMinutes}m` : ""}`,
      };
    }
  }
}

/** Which identity classes an assertion governs, falling back to its parent's. */
function assertionScope(a: Assertion, parentScope: IdentityClass[]): IdentityClass[] {
  return a.appliesTo?.length ? a.appliesTo : parentScope;
}

// ---------------------------------------------------------------------------
// Semantic version diff
// ---------------------------------------------------------------------------

export interface AssertionDelta {
  kind: Assertion["kind"];
  change: "added" | "removed" | "tightened" | "loosened" | "unchanged";
  before?: Assertion;
  after?: Assertion;
  summary: string;
}

export interface RequirementDiff {
  requirementId: string;
  fromVersion: number;
  toVersion: number;
  applicabilityAdded: IdentityClass[];
  applicabilityRemoved: IdentityClass[];
  environmentsAdded: string[];
  environmentsRemoved: string[];
  riskLevelChanged?: { from: string; to: string };
  verificationMethodChanged?: { from: string; to: string };
  assertionDeltas: AssertionDelta[];
  summary: string;
}

/**
 * A semantic diff, not a text diff. Two requirement versions differ in the
 * bounds they set, and "tightened" is the only classification that matters
 * downstream — it is what invalidates controls, tests, and exceptions.
 */
export function diffRequirementVersions(
  before: RequirementVersion,
  after: RequirementVersion,
): RequirementDiff {
  const applicabilityAdded = after.applicability.filter((c) => !before.applicability.includes(c));
  const applicabilityRemoved = before.applicability.filter((c) => !after.applicability.includes(c));
  const environmentsAdded = after.environments.filter((e) => !before.environments.includes(e));
  const environmentsRemoved = before.environments.filter((e) => !after.environments.includes(e));

  const kinds = new Set<Assertion["kind"]>([
    ...before.assertions.map((a) => a.kind),
    ...after.assertions.map((a) => a.kind),
  ]);

  const assertionDeltas: AssertionDelta[] = [];
  for (const kind of kinds) {
    const b = before.assertions.find((a) => a.kind === kind);
    const a = after.assertions.find((x) => x.kind === kind);
    if (!b && a) {
      assertionDeltas.push({ kind, change: "added", after: a, summary: describeAssertion(a) + " (new)" });
      continue;
    }
    if (b && !a) {
      assertionDeltas.push({ kind, change: "removed", before: b, summary: describeAssertion(b) + " (dropped)" });
      continue;
    }
    if (!b || !a) continue;

    // If the old assertion no longer satisfies the new one, the bound tightened.
    const oldMeetsNew = satisfies(a, b).satisfied;
    const newMeetsOld = satisfies(b, a).satisfied;
    const change: AssertionDelta["change"] = oldMeetsNew && newMeetsOld
      ? "unchanged"
      : oldMeetsNew
        ? "loosened"
        : "tightened";
    assertionDeltas.push({
      kind,
      change,
      before: b,
      after: a,
      summary: change === "unchanged"
        ? describeAssertion(a)
        : `${describeAssertion(b)} → ${describeAssertion(a)}`,
    });
  }

  const parts: string[] = [];
  const tightened = assertionDeltas.filter((d) => d.change === "tightened" || d.change === "added");
  if (tightened.length) parts.push(`${tightened.length} requirement(s) tightened`);
  if (applicabilityAdded.length) parts.push(`scope extended to ${list(applicabilityAdded)}`);
  if (applicabilityRemoved.length) parts.push(`scope narrowed from ${list(applicabilityRemoved)}`);
  if (before.verificationMethod !== after.verificationMethod) {
    parts.push(`verification changes to ${after.verificationMethod}`);
  }

  return {
    requirementId: after.requirementId,
    fromVersion: before.version,
    toVersion: after.version,
    applicabilityAdded,
    applicabilityRemoved,
    environmentsAdded,
    environmentsRemoved,
    riskLevelChanged:
      before.riskLevel === after.riskLevel
        ? undefined
        : { from: before.riskLevel, to: after.riskLevel },
    verificationMethodChanged:
      before.verificationMethod === after.verificationMethod
        ? undefined
        : { from: before.verificationMethod, to: after.verificationMethod },
    assertionDeltas,
    summary: parts.length
      ? `${after.code} v${before.version} → v${after.version}: ${parts.join("; ")}.`
      : `${after.code} v${before.version} → v${after.version}: editorial only, no change in obligations.`,
  };
}

export function describeAssertion(a: Assertion): string {
  switch (a.kind) {
    case "auth_factor_policy":
      return a.requirePhishingResistant
        ? "phishing-resistant factors only"
        : `factors {${list(a.permittedFactors)}}${a.allowsFallback ? " with fallback" : ""}`;
    case "review_cadence":
      return `review every ${a.intervalDays} days`;
    case "log_retention":
      return `retain ${a.retentionDays} days${a.immutable ? " immutably" : ""}`;
    case "credential_rotation":
      return `rotate within ${a.maxAgeDays} days`;
    case "scan_cadence":
      return `scan every ${a.intervalDays} days`;
    case "approval_workflow":
      return `${a.approversRequired} approver(s)${a.postIncidentReviewHours ? `, ${a.postIncidentReviewHours}h review` : ""}`;
    case "monitoring_alert":
      return `alert ${a.destination}${a.maxLatencyMinutes ? ` within ${a.maxLatencyMinutes}m` : ""}`;
  }
}

// ---------------------------------------------------------------------------
// Change impact analysis
// ---------------------------------------------------------------------------

let findingCounter = 0;
const findingId = () => `F-${(++findingCounter).toString().padStart(3, "0")}`;

/** Reset between runs so ids are stable per analysis, not per session. */
function resetFindingIds() {
  findingCounter = 0;
}

function finding(
  kind: Finding["kind"],
  severity: Severity,
  requirementId: string,
  entityIds: string[],
  summary: string,
  derivation: Derivation,
): Finding {
  return { id: findingId(), kind, severity, requirementId, entityIds, summary, derivation };
}

export interface ChangeImpact {
  requirementId: string;
  fromVersion: number;
  toVersion: number;
  diff: RequirementDiff;
  findings: Finding[];
  /** Identity classes newly in scope that some entity in the graph represents. */
  newlyInScope: IdentityClass[];
  summary: string;
}

/**
 * The centerpiece. Given the current graph and a proposed next version of a
 * requirement, derive what breaks.
 *
 * `respectApproved` is the demo's "don't touch approved controls or sprint
 * work" instruction: findings are still produced, but nothing is mutated —
 * which is true of this function unconditionally. It computes and returns; it
 * never writes.
 */
export function analyzeChangeImpact(
  index: GraphIndex,
  before: RequirementVersion,
  after: RequirementVersion,
): ChangeImpact {
  resetFindingIds();
  const diff = diffRequirementVersions(before, after);
  const findings: Finding[] = [];
  const requirementId = after.requirementId;
  const present = identityClassesPresent(index);

  // --- Rule 1: scope expansion -------------------------------------------
  // Newly-applicable identity classes only count as findings when the graph
  // actually contains something of that class. An abstract widening nobody
  // implements is not an impact.
  const newlyInScope = diff.applicabilityAdded.filter((c) => present.has(c));
  const controls = controlsFor(index, requirementId, { includeProposed: true });

  for (const identityClass of newlyInScope) {
    const covering = controls.filter((c) => c.coversIdentityClasses.includes(identityClass));
    const exceptionsCovering = allExceptions(index).filter((e) => e.appliesTo.includes(identityClass));
    findings.push(
      finding(
        covering.length ? "scope_expansion" : "coverage_gap",
        covering.length ? "moderate" : "high",
        requirementId,
        [...covering.map((c) => c.id), ...exceptionsCovering.map((e) => e.id)],
        covering.length
          ? `${identityClass} is newly in scope for ${after.code}; ${covering.map((c) => c.code).join(", ")} already covers this class and must now satisfy the revised assertions.`
          : `${identityClass} is newly in scope for ${after.code} and no control covers it.`,
        {
          rule: "scope_expansion/applicability_delta",
          expected: `${after.code} v${after.version} applies to {${list(after.applicability)}}`,
          observed: `v${before.version} applied to {${list(before.applicability)}}; ${identityClass} present in graph via ${
            [...covering.map((c) => c.code), ...exceptionsCovering.map((e) => e.code)].join(", ") || "no entity"
          }`,
          comparedEntityIds: [before.id, after.id, ...covering.map((c) => c.id)],
        },
      ),
    );
  }

  // --- Rule 2: control insufficiency --------------------------------------
  // Only controls actually linked to this requirement propagate staleness to
  // work items. A control found by the cross-cutting pass is a finding in its
  // own right, but the sprint work under it was never aimed at this requirement.
  const insufficientControls = new Set<string>();
  const insufficientUnlinked = new Set<string>();
  const addressedKinds = new Set<Assertion["kind"]>();
  for (const control of controls) {
    for (const required of after.assertions) {
      const scope = assertionScope(required, after.applicability);
      // Only judge a control against assertions governing a class it covers.
      if (!scope.some((c) => control.coversIdentityClasses.includes(c))) continue;

      // A control that says nothing about this assertion kind is not thereby
      // insufficient — it is simply not the control that addresses it. Whether
      // anything addresses it is decided once, in Rule 2c.
      const candidates = control.properties.filter((p) => p.kind === required.kind);
      if (candidates.length === 0) continue;

      addressedKinds.add(required.kind);
      for (const candidate of candidates) {
        const result = satisfies(required, candidate);
        if (result.satisfied) continue;
        insufficientControls.add(control.id);
        findings.push(
          finding(
            "control_insufficient",
            after.riskLevel === "critical" ? "critical" : "high",
            requirementId,
            [control.id],
            `${control.code} ${result.observed}; ${after.code} v${after.version} requires ${result.expected}.`,
            {
              rule: `control_insufficient/${required.kind}`,
              expected: `${after.code} v${after.version}: ${result.expected}`,
              observed: `${control.code} (${control.enforcedIn.map((r) => `${r.system}:${r.ref}`).join(", ")}): ${result.observed}`,
              comparedEntityIds: [after.id, control.id],
            },
          ),
        );
      }
    }
  }

  // --- Rule 2b: unlinked candidate controls --------------------------------
  // The cross-cutting pass. When a requirement makes a demand that none of its
  // linked controls addresses, look for a control elsewhere in the graph that
  // governs the same identity classes and does address it. Those are the
  // controls a human would have to already know about to check — the review
  // cadence configured by a different team, under a different requirement.
  for (const required of after.assertions) {
    const scope = assertionScope(required, after.applicability);
    const linkedAddresses = controls.some(
      (c) =>
        c.properties.some((p) => p.kind === required.kind) &&
        scope.some((s) => c.coversIdentityClasses.includes(s)),
    );
    if (linkedAddresses) continue;

    for (const candidate of allControlsIn(index)) {
      if (controls.some((c) => c.id === candidate.id)) continue;
      const overlap = scope.filter((s) => candidate.coversIdentityClasses.includes(s));
      if (!overlap.length) continue;
      const property = candidate.properties.find((p) => p.kind === required.kind);
      if (!property) continue;

      addressedKinds.add(required.kind);
      const result = satisfies(required, property);
      if (result.satisfied) continue;
      insufficientUnlinked.add(candidate.id);
      findings.push(
        finding(
          "control_insufficient",
          "high",
          requirementId,
          [candidate.id],
          `${candidate.code} governs ${list(overlap)} and ${result.observed}; ${after.code} v${after.version} requires ${result.expected}. It has no trace link to ${after.code}.`,
          {
            rule: `control_insufficient/unlinked_candidate.${required.kind}`,
            expected: `${after.code} v${after.version}: ${result.expected}`,
            observed: `${candidate.code} (${candidate.enforcedIn.map((r) => `${r.system}:${r.ref}`).join(", ")}) ${result.observed}, and implements ${
              edgesFrom(index, candidate.id, "implements").map((e) => e.to).join(", ") || "nothing"
            } rather than ${after.code}`,
            comparedEntityIds: [after.id, candidate.id],
          },
        ),
      );
    }
  }

  // --- Rule 2c: unaddressed demand ----------------------------------------
  // The requirement asks for something no control anywhere in the graph
  // declares for these identity classes. That is a coverage gap, reported once
  // per demand rather than once per control that happens not to mention it.
  for (const required of after.assertions) {
    if (addressedKinds.has(required.kind)) continue;
    const scope = assertionScope(required, after.applicability);
    findings.push(
      finding(
        "coverage_gap",
        "high",
        requirementId,
        [after.id, ...controls.map((c) => c.id)],
        `Nothing in the graph declares ${required.kind.replace(/_/g, " ")} for ${list(scope)}, which ${after.code} v${after.version} requires (${describeAssertion(required)}).`,
        {
          rule: "coverage_gap/unaddressed_assertion",
          expected: `a control governing {${list(scope)}} that declares ${required.kind}`,
          observed: `no control in the graph declares ${required.kind} for these classes`,
          comparedEntityIds: [after.id],
        },
      ),
    );
  }

  // --- Rule 3: test invalidation ------------------------------------------
  // A test stops proving a requirement when what it asserts no longer implies
  // what the requirement demands — even when the test still passes.
  for (const control of controls) {
    for (const test of testsFor(index, control.id)) {
      for (const required of after.assertions) {
        const check = test.assertions.find((a) => a.kind === required.kind);
        if (!check) continue;
        const result = satisfies(required, check);
        if (result.satisfied) continue;
        findings.push(
          finding(
            "test_invalidated",
            "high",
            requirementId,
            [test.id, control.id],
            `${test.id} no longer proves ${after.code}: it asserts ${describeAssertion(check)}, which does not establish ${result.expected}.`,
            {
              rule: `test_invalidated/${required.kind}`,
              expected: `${after.code} v${after.version}: ${result.expected}`,
              observed: `${test.id} (${test.sourceRef.system}:${test.sourceRef.ref}) asserts: ${result.observed}`,
              comparedEntityIds: [after.id, test.id],
            },
          ),
        );
      }

      // A method change can invalidate a test even when its assertions hold.
      if (
        diff.verificationMethodChanged &&
        test.verifies !== after.verificationMethod &&
        !findings.some((f) => f.kind === "test_invalidated" && f.entityIds.includes(test.id))
      ) {
        findings.push(
          finding(
            "test_invalidated",
            "moderate",
            requirementId,
            [test.id],
            `${after.code} now requires ${after.verificationMethod}; ${test.id} provides ${test.verifies}.`,
            {
              rule: "test_invalidated/verification_method",
              expected: `verification by ${after.verificationMethod}`,
              observed: `${test.id} verifies by ${test.verifies}`,
              comparedEntityIds: [after.id, test.id],
            },
          ),
        );
      }
    }
  }

  // --- Rule 4: exception conflict -----------------------------------------
  // An exception conflicts when the relief it grants is no longer relief the
  // revised requirement can tolerate.
  const seenExceptions = new Set<string>();
  for (const control of controls) {
    for (const exception of exceptionsFor(index, control.id)) {
      if (seenExceptions.has(exception.id)) continue;
      const inScope = exception.appliesTo.some((c) => after.applicability.includes(c));
      if (!inScope) continue;

      for (const required of after.assertions) {
        const grounds = exception.grounds.find((g) => g.kind === required.kind);
        if (!grounds) continue;
        const result = satisfies(required, grounds);
        if (result.satisfied) continue;
        seenExceptions.add(exception.id);
        findings.push(
          finding(
            "exception_conflict",
            "high",
            requirementId,
            [exception.id, control.id],
            `${exception.code} grants relief that ${after.code} v${after.version} no longer permits (${result.observed}); it requires reapproval before ${exception.expiresAt}.`,
            {
              rule: `exception_conflict/${required.kind}`,
              expected: `${after.code} v${after.version}: ${result.expected}`,
              observed: `${exception.code} (${exception.sourceRef.system}:${exception.sourceRef.ref}) grants: ${result.observed}`,
              comparedEntityIds: [after.id, exception.id],
            },
          ),
        );
        break;
      }
    }
  }

  // --- Rule 5: work staleness ---------------------------------------------
  // Transitive: work fulfilling a control whose sufficiency changed was written
  // against acceptance criteria that no longer describe the target.
  for (const controlId of insufficientControls) {
    const control = index.entities.get(controlId);
    if (control?.kind !== "control") continue;
    for (const item of workItemsFor(index, controlId)) {
      if (item.status === "done") continue;
      findings.push(
        finding(
          "work_stale",
          item.status === "in_progress" || item.status === "in_review" ? "moderate" : "low",
          requirementId,
          [item.id, controlId],
          `${item.sourceRef.system === "jira" ? "Jira" : "Azure Boards"} ${item.sourceRef.ref} implements ${control.code}, whose target moved; its acceptance criteria are potentially outdated.`,
          {
            rule: "work_stale/transitive_via_control",
            expected: `${control.code} to satisfy ${after.code} v${after.version}`,
            observed: `${item.sourceRef.ref} (${item.status}) fulfills ${control.code} against the previous target`,
            comparedEntityIds: [after.id, controlId, item.id],
          },
        ),
      );
    }
  }

  const byKind = (k: Finding["kind"]) => findings.filter((f) => f.kind === k).length;
  const summary =
    `${after.code} v${before.version} → v${after.version}: ${findings.length} finding(s) — ` +
    `${byKind("scope_expansion") + byKind("coverage_gap")} scope, ${byKind("control_insufficient")} control, ` +
    `${byKind("test_invalidated")} test, ${byKind("exception_conflict")} exception, ${byKind("work_stale")} work.`;

  return {
    requirementId,
    fromVersion: before.version,
    toVersion: after.version,
    diff,
    findings,
    newlyInScope,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Standing gap detection (independent of any change)
// ---------------------------------------------------------------------------

export type GapScope = "controls" | "evidence" | "conflicts" | "all";

export function detectGaps(
  index: GraphIndex,
  scope: GapScope,
  today: string,
): Finding[] {
  resetFindingIds();
  const findings: Finding[] = [];
  const want = (s: GapScope) => scope === "all" || scope === s;

  if (want("controls")) {
    for (const requirement of requirementsOf(index)) {
      const controls = controlsFor(index, requirement.requirementId);
      if (controls.length === 0) {
        findings.push(
          finding(
            "coverage_gap",
            requirement.riskLevel === "critical" || requirement.riskLevel === "high" ? "high" : "moderate",
            requirement.requirementId,
            [requirement.id],
            `${requirement.code} has no control implementing it.`,
            {
              rule: "coverage_gap/no_implements_edge",
              expected: `at least one approved implements edge into ${requirement.code}`,
              observed: "none",
              comparedEntityIds: [requirement.id],
            },
          ),
        );
        continue;
      }
      const uncoveredClasses = requirement.applicability.filter(
        (c) => !controls.some((ctl) => ctl.coversIdentityClasses.includes(c)),
      );
      if (uncoveredClasses.length) {
        findings.push(
          finding(
            "coverage_gap",
            "moderate",
            requirement.requirementId,
            [requirement.id, ...controls.map((c) => c.id)],
            `${requirement.code} applies to ${list(uncoveredClasses)}, which no linked control covers.`,
            {
              rule: "coverage_gap/identity_class_uncovered",
              expected: `controls covering {${list(requirement.applicability)}}`,
              observed: `${controls.map((c) => `${c.code} covers {${list(c.coversIdentityClasses)}}`).join("; ")}`,
              comparedEntityIds: [requirement.id, ...controls.map((c) => c.id)],
            },
          ),
        );
      }
    }
  }

  if (want("evidence")) {
    for (const entity of index.entities.values()) {
      if (entity.kind !== "evidence") continue;
      const age = Math.round(
        (Date.parse(today + "T00:00:00Z") - Date.parse(entity.lastVerified + "T00:00:00Z")) / 86_400_000,
      );
      if (age <= entity.freshnessWindowDays) continue;
      const attachedTo = edgesTo(index, entity.id).concat(
        index.outgoing.get(entity.id) ?? [],
      );
      findings.push(
        finding(
          "evidence_stale",
          age > entity.freshnessWindowDays * 1.25 ? "high" : "moderate",
          "",
          [entity.id, ...attachedTo.map((e) => e.to)],
          `${entity.id} (${entity.sourceRef.system}:${entity.sourceRef.ref}) was last verified ${age} days ago; its freshness window is ${entity.freshnessWindowDays} days.`,
          {
            rule: "evidence_stale/freshness_window",
            expected: `verified within ${entity.freshnessWindowDays} days of ${today}`,
            observed: `last verified ${entity.lastVerified} (${age} days)`,
            comparedEntityIds: [entity.id],
          },
        ),
      );
    }
  }

  if (want("conflicts")) {
    for (const exception of allExceptions(index)) {
      const remaining = Math.round(
        (Date.parse(exception.expiresAt + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000,
      );
      if (remaining > 45) continue;
      findings.push(
        finding(
          "exception_conflict",
          remaining < 0 ? "critical" : "moderate",
          "",
          [exception.id, ...exception.exemptsControlIds],
          remaining < 0
            ? `${exception.code} expired ${-remaining} days ago and the carve-out is still in effect.`
            : `${exception.code} expires in ${remaining} days (${exception.expiresAt}).`,
          {
            rule: "exception_conflict/expiry_window",
            expected: `active approval on ${today}`,
            observed: `${exception.code} expires ${exception.expiresAt} (${exception.sourceRef.system}:${exception.sourceRef.ref})`,
            comparedEntityIds: [exception.id],
          },
        ),
      );
    }

    // A control both required and excepted for the same identity class is a
    // standing conflict worth surfacing before an assessor finds it.
    for (const exception of allExceptions(index)) {
      for (const controlId of exception.exemptsControlIds) {
        const control = index.entities.get(controlId);
        if (control?.kind !== "control") continue;
        const overlap = exception.appliesTo.filter((c) => control.coversIdentityClasses.includes(c));
        if (!overlap.length) continue;
        findings.push(
          finding(
            "exception_conflict",
            "info",
            "",
            [exception.id, controlId],
            `${control.code} claims coverage of ${list(overlap)} while ${exception.code} exempts the same class.`,
            {
              rule: "exception_conflict/coverage_overlap",
              expected: `${control.code} coverage and ${exception.code} relief to be disjoint`,
              observed: `both address {${list(overlap)}}`,
              comparedEntityIds: [controlId, exception.id],
            },
          ),
        );
      }
    }
  }

  return findings;
}

function requirementsOf(index: GraphIndex): RequirementVersion[] {
  const out: RequirementVersion[] = [];
  for (const id of index.requirementVersions.keys()) {
    const r = currentRequirement(index, id);
    if (r) out.push(r);
  }
  return out;
}

export type { Control, TestDefinition };
