/**
 * Readiness score.
 *
 * Never a hardcoded number. `calculate_readiness` returns this whole object,
 * breakdown included, so the score can be argued with.
 *
 *   readiness = 100 * Σ (weight_i × score_i)
 *
 * Requirement-level components are risk-weighted (critical 4, high 3,
 * moderate 2, low 1), because an uncovered critical requirement and an
 * uncovered low-risk one are not the same finding.
 */

import {
  allEvidence,
  allExceptions,
  controlsFor,
  currentRequirements,
  evidenceFor,
  evidenceFreshnessCredit,
  isExceptionExpiringSoon,
  testsFor,
  isEvidenceStale,
  type GraphIndex,
} from "./graph";
import { satisfies } from "./impact";
import { DEMO_TODAY } from "./seed";
import type {
  Assertion,
  Control,
  Exception,
  IdentityClass,
  IsoDate,
  Proposal,
  Readiness,
  ReadinessComponent,
  RequirementVersion,
  RiskLevel,
} from "./types";

export const RISK_WEIGHT: Record<RiskLevel, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
};

export const READINESS_WEIGHTS = {
  coverage: 0.3,
  verification: 0.2,
  evidence_freshness: 0.25,
  exception_health: 0.15,
  open_proposals: 0.1,
} as const;

export const READINESS_FORMULA =
  "readiness = 100 × (0.30·coverage + 0.20·verification + 0.25·evidence_freshness " +
  "+ 0.15·exception_health + 0.10·open_proposals). Coverage and verification are " +
  "risk-weighted (critical 4, high 3, moderate 2, low 1).";

function statusCredit(control: Control): number {
  switch (control.implementationStatus) {
    case "implemented":
      return 1;
    case "partially_implemented":
      return 0.5;
    case "planned":
      return 0.25;
    default:
      return 0;
  }
}

const scopeOf = (a: Assertion, parent: IdentityClass[]): IdentityClass[] =>
  a.appliesTo?.length ? a.appliesTo : parent;

/**
 * What fraction of the requirement's obligations this control actually meets.
 *
 * A control that exists is not a control that suffices. Coverage that counted
 * only the presence of an `implements` edge would report a requirement as
 * covered by a control whose configuration contradicts it — which is the exact
 * false confidence this system exists to prevent, and the reason the score has
 * to move when a requirement tightens.
 */
function controlSatisfaction(requirement: RequirementVersion, control: Control): number {
  const relevant = requirement.assertions.filter((a) =>
    scopeOf(a, requirement.applicability).some((c) => control.coversIdentityClasses.includes(c)),
  );
  if (relevant.length === 0) return 1;
  const met = relevant.filter((a) =>
    control.properties.some((p) => p.kind === a.kind && satisfies(a, p).satisfied),
  ).length;
  return met / relevant.length;
}

/** How much credit a requirement gets for the controls implementing it. */
function coverageCredit(index: GraphIndex, requirement: RequirementVersion): number {
  const controls = controlsFor(index, requirement.requirementId);
  if (controls.length === 0) return 0;

  const best = Math.max(...controls.map((c) => statusCredit(c) * controlSatisfaction(requirement, c)));

  // Applicability the linked controls do not reach at all is uncovered scope,
  // and it scales the credit down rather than being invisible.
  const reached = requirement.applicability.filter((cls) =>
    controls.some((c) => c.coversIdentityClasses.includes(cls)),
  ).length;
  const scopeRatio = requirement.applicability.length ? reached / requirement.applicability.length : 1;

  return best * scopeRatio;
}

/** Does this exception grant relief the requirement can still tolerate? */
function exceptionConflicts(index: GraphIndex, exception: Exception): boolean {
  for (const controlId of exception.exemptsControlIds) {
    for (const edge of index.outgoing.get(controlId) ?? []) {
      if (edge.type !== "implements") continue;
      const requirement = currentRequirements(index).find((r) => r.requirementId === edge.to);
      if (!requirement) continue;
      if (!exception.appliesTo.some((c) => requirement.applicability.includes(c))) continue;
      for (const required of requirement.assertions) {
        const grounds = exception.grounds.find((g) => g.kind === required.kind);
        if (grounds && !satisfies(required, grounds).satisfied) return true;
      }
    }
  }
  return false;
}

/**
 * Is the requirement's declared verification method actually satisfied?
 * Automated methods need a passing test on a linked control; attestation-style
 * methods need evidence that is still inside its freshness window.
 */
function verificationCredit(
  index: GraphIndex,
  requirement: RequirementVersion,
  today: IsoDate,
): number {
  const controls = controlsFor(index, requirement.requirementId);
  if (controls.length === 0) return 0;

  const wantsAutomation =
    requirement.verificationMethod === "automated_test" ||
    requirement.verificationMethod === "continuous_monitoring" ||
    requirement.verificationMethod === "configuration_export";

  for (const control of controls) {
    if (wantsAutomation) {
      const proving = testsFor(index, control.id).filter(
        (t) =>
          t.lastResult === "pass" &&
          // A green test that asserts something weaker than the requirement
          // demands is not evidence of the requirement.
          requirement.assertions.every((a) => {
            const check = t.assertions.find((x) => x.kind === a.kind);
            return !check || satisfies(a, check).satisfied;
          }),
      );
      if (proving.length) return 1;
    }
    const evidence = evidenceFor(index, control.id);
    if (evidence.some((e) => !isEvidenceStale(e, today))) return wantsAutomation ? 0.5 : 1;
  }
  return 0;
}

export function calculateReadiness(
  index: GraphIndex,
  proposals: Proposal[] = [],
  today: IsoDate = DEMO_TODAY,
): Readiness {
  const requirements = currentRequirements(index);
  const totalRisk = requirements.reduce((sum, r) => sum + RISK_WEIGHT[r.riskLevel], 0) || 1;

  // 1. Coverage
  let coverageEarned = 0;
  const uncovered: string[] = [];
  for (const r of requirements) {
    const credit = coverageCredit(index, r);
    coverageEarned += credit * RISK_WEIGHT[r.riskLevel];
    if (credit < 1) uncovered.push(`${r.code}${credit === 0 ? "" : " (partial)"}`);
  }
  const coverage = coverageEarned / totalRisk;

  // 2. Verification
  let verificationEarned = 0;
  const unverified: string[] = [];
  for (const r of requirements) {
    const credit = verificationCredit(index, r, today);
    verificationEarned += credit * RISK_WEIGHT[r.riskLevel];
    if (credit < 1) unverified.push(r.code);
  }
  const verification = verificationEarned / totalRisk;

  // 3. Evidence freshness
  const evidence = allEvidence(index);
  const freshnessCredits = evidence.map((e) => evidenceFreshnessCredit(e, today));
  const staleCount = evidence.filter((e) => isEvidenceStale(e, today)).length;
  const freshness = evidence.length
    ? freshnessCredits.reduce((a, b) => a + b, 0) / evidence.length
    : 1;

  // 4. Exception health
  const exceptions = allExceptions(index).filter((e) => e.status !== "revoked");
  const unhealthy = exceptions.filter(
    (e) =>
      e.status === "expired" ||
      e.status === "requires_reapproval" ||
      isExceptionExpiringSoon(e, today) ||
      exceptionConflicts(index, e),
  );
  const exceptionHealth = exceptions.length
    ? (exceptions.length - unhealthy.length) / exceptions.length
    : 1;

  // 5. Open proposals — unreviewed agent output is unfinished business.
  const pending = proposals.filter((p) => p.status === "pending").length;
  const openProposals = Math.max(0, 1 - pending / 10);

  const components: ReadinessComponent[] = [
    {
      key: "coverage",
      label: "Control coverage",
      weight: READINESS_WEIGHTS.coverage,
      score: coverage,
      detail: uncovered.length
        ? `Risk-weighted by control sufficiency, not mere presence. Gaps: ${uncovered.join(", ")}.`
        : "Every requirement has an implemented control.",
    },
    {
      key: "verification",
      label: "Verification",
      weight: READINESS_WEIGHTS.verification,
      score: verification,
      detail: unverified.length
        ? `Declared verification method not fully satisfied for: ${unverified.join(", ")}.`
        : "Every requirement's verification method is satisfied.",
    },
    {
      key: "evidence_freshness",
      label: "Evidence freshness",
      weight: READINESS_WEIGHTS.evidence_freshness,
      score: freshness,
      detail: `${staleCount} of ${evidence.length} evidence items are past their freshness window.`,
    },
    {
      key: "exception_health",
      label: "Exception health",
      weight: READINESS_WEIGHTS.exception_health,
      score: exceptionHealth,
      detail: unhealthy.length
        ? `${unhealthy.map((e) => e.code).join(", ")} expiring, lapsed, or granting relief the current requirement no longer permits.`
        : "No exception is expiring or lapsed.",
    },
    {
      key: "open_proposals",
      label: "Open proposals",
      weight: READINESS_WEIGHTS.open_proposals,
      score: openProposals,
      detail: `${pending} proposal(s) awaiting human review.`,
    },
  ];

  const score = Math.round(
    100 * components.reduce((sum, c) => sum + c.weight * c.score, 0),
  );

  return { score, components, formula: READINESS_FORMULA };
}
