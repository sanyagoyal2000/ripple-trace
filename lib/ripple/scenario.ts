import { analyzeChangeImpact } from './impact';
import { calculateReadiness } from './readiness';
import { currentRequirement, indexSnapshot } from './graph';
import { seedSnapshot } from './seed';
import type { Finding, GraphSnapshot, RequirementVersion } from './types';

export const proposedRequirement: RequirementVersion = {
  ...currentRequirement(indexSnapshot(seedSnapshot()), 'AC-2')!,
  id: 'AC-2@3',
  version: 3,
  text: 'All privileged human and workload identities accessing production infrastructure must use phishing-resistant authentication, with access reviewed every 90 days.',
  effectiveDate: '2026-10-01',
  approvalStatus: 'draft',
  supersedes: 'AC-2@2',
  changeSummary: 'Extends coverage to workload identities and break-glass access; removes weak-factor fallback; introduces quarterly review.',
  applicability: ['human_privileged', 'contractor', 'service_principal', 'managed_identity', 'ci_runner_identity', 'break_glass'],
  assertions: [
    { kind: 'auth_factor_policy', permittedFactors: ['fido2', 'smartcard_piv', 'workload_federation'], requirePhishingResistant: true, allowsFallback: false },
    { kind: 'review_cadence', intervalDays: 90 },
  ],
};

export function runRippleAnalysis() {
  const snapshot = seedSnapshot();
  const index = indexSnapshot(snapshot);
  const before = currentRequirement(index, 'AC-2')!;
  const impact = analyzeChangeImpact(index, before, proposedRequirement);
  const baseline = calculateReadiness(index);
  const revisedSnapshot: GraphSnapshot = {
    ...snapshot,
    entities: [
      ...snapshot.entities.map((e) => e.id === before.id && e.kind === 'requirement' ? { ...e, approvalStatus: 'superseded' as const } : e),
      { ...proposedRequirement, approvalStatus: 'approved' as const },
    ],
  };
  const revised = calculateReadiness(indexSnapshot(revisedSnapshot));
  return { snapshot, before, impact, baseline, revised };
}

export function proposalForFinding(finding: Finding) {
  const labels: Record<Finding['kind'], string> = {
    coverage_gap: 'Create or extend an implementing control',
    scope_expansion: 'Review newly applicable identity scope',
    control_insufficient: 'Update control configuration',
    test_invalidated: 'Revise automated verification',
    exception_conflict: 'Request exception reapproval',
    work_stale: 'Refresh work-item acceptance criteria',
    evidence_stale: 'Collect fresh evidence',
  };
  return { id: `PROP-${finding.id.slice(2)}`, title: labels[finding.kind], rationale: finding.summary, findingId: finding.id, severity: finding.severity, entityIds: finding.entityIds };
}
