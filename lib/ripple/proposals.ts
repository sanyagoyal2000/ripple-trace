/**
 * Turning findings into proposals a human can act on.
 *
 * A proposal is not a label on a finding. It carries a `payload` — the exact
 * configuration change being asked for — so that approving it mutates the
 * graph, the analyzer re-runs against the mutated graph, and the readiness
 * score moves because the world moved. Nothing about the score is scripted.
 */

import { describeAssertion } from './impact';
import type { Assertion, Finding, Proposal, Provenance } from './types';

const AGENT = 'agent:webmcp';

function agentProvenance(rationale: string, at: string): Provenance {
  return { createdBy: AGENT, origin: 'agent', createdAt: at, rationale, state: 'proposed' };
}

/**
 * The remediation each finding implies, derived from the finding's own
 * derivation rather than from a lookup table of pre-written outcomes.
 */
export function proposalsForFinding(finding: Finding, today: string): Proposal[] {
  const base = {
    reviewId: undefined,
    derivedFromFindingId: finding.id,
    status: 'pending' as const,
    provenance: agentProvenance(finding.summary, today),
  };
  const id = (suffix: string) => `PROP-${finding.id.slice(2)}-${suffix}`;

  switch (finding.kind) {
    case 'control_insufficient': {
      const controlId = finding.entityIds.find((entityId) => entityId.startsWith('CTL-'));
      if (!controlId) return [];
      // What the control must become is read off the rule that failed, so the
      // proposal is answerable to the same comparison that produced the finding.
      const properties: Assertion[] = finding.derivation.rule.includes('auth_factor_policy')
        ? [{
            kind: 'auth_factor_policy',
            permittedFactors: ['fido2', 'smartcard_piv', 'workload_federation'],
            requirePhishingResistant: true,
            allowsFallback: false,
          }]
        : finding.derivation.rule.includes('review_cadence')
          ? [{ kind: 'review_cadence', intervalDays: 90 }]
          : [];
      if (!properties.length) return [];
      return [{
        ...base,
        id: id('cfg'),
        kind: 'control_update',
        title: `${controlId}: ${properties.map(describeAssertion).join('; ')}`,
        rationale: finding.summary,
        targetEntityId: controlId,
        payload: { properties, coversIdentityClasses: [] },
      }];
    }

    case 'coverage_gap': {
      const identityClass = finding.summary.match(
        /(service_principal|managed_identity|ci_runner_identity|break_glass|contractor|third_party_integration|human_privileged)/,
      )?.[0];
      return [{
        ...base,
        id: id('ctl'),
        kind: 'control',
        title: identityClass
          ? `New control governing ${identityClass.replace(/_/g, ' ')}`
          : 'New control closing an unaddressed obligation',
        rationale: finding.summary,
        payload: {
          requirementId: finding.requirementId || 'AC-2',
          coversIdentityClasses: identityClass ? [identityClass] : [],
          properties: [{
            kind: 'auth_factor_policy',
            permittedFactors: ['workload_federation', 'fido2'],
            requirePhishingResistant: true,
            allowsFallback: false,
          }],
          implementationNotes:
            'Federated workload identity issued per workload, with no long-lived secret to phish.',
        },
      }];
    }

    case 'test_invalidated': {
      const testId = finding.entityIds.find((entityId) => entityId.startsWith('test-'));
      if (!testId) return [];
      return [{
        ...base,
        id: id('test'),
        kind: 'test_revision',
        title: `Revise ${testId} to assert factor strength, not just presence`,
        rationale: finding.summary,
        targetEntityId: testId,
        payload: {
          assertions: [{
            kind: 'auth_factor_policy',
            permittedFactors: ['fido2', 'smartcard_piv', 'workload_federation'],
            requirePhishingResistant: true,
            allowsFallback: false,
          }],
        },
      }];
    }

    case 'exception_conflict': {
      const exceptionId = finding.entityIds.find((entityId) => entityId.startsWith('EXC-'));
      if (!exceptionId) return [];
      // EXC-11 is the break-glass carve-out. A reviewer who knows why
      // break-glass exists will reject a hardware-key answer here; that
      // rejection is the point, and it is preserved in the audit packet.
      return [{
        ...base,
        id: id('exc'),
        kind: 'exception_reapproval',
        title: `${exceptionId} requires reapproval against the revised requirement`,
        rationale: finding.summary,
        targetEntityId: exceptionId,
        payload: { requiresReapproval: true },
      }];
    }

    case 'work_stale': {
      const workId = finding.entityIds.find((entityId) => entityId.startsWith('WI-'));
      if (!workId) return [];
      return [{
        ...base,
        id: id('work'),
        kind: 'work_item',
        title: `Revise acceptance criteria on ${workId.replace('WI-', '')}`,
        rationale: finding.summary,
        targetEntityId: workId,
        payload: {
          acceptanceCriteria: [
            'Only phishing-resistant factors are accepted for privileged sessions',
            'No fallback path re-enables a weak factor when enrollment is missing',
          ],
        },
      }];
    }

    default:
      return [];
  }
}

/**
 * The compensating-control path.
 *
 * Created only when a human tells the agent something it could not have known —
 * that a break-glass credential must not depend on the identity provider,
 * because that is the failure it exists for. The agent does not overwrite the
 * requirement and does not argue; it proposes a path that honours the
 * constraint, and a human still decides.
 */
export function compensatingControlProposal(today: string): Proposal[] {
  const provenance = agentProvenance(
    'Reviewer constraint: break-glass retrieval must not depend on Entra ID, because IdP ' +
      'unavailability is the condition break-glass exists for. Factor strength cannot be the answer.',
    today,
  );
  return [
    {
      id: 'PROP-BG-ctl',
      kind: 'control',
      title: 'Compensating control for regional control-plane break-glass',
      rationale:
        'Offline-sealed credentials in a physical safe, dual-authorization retrieval, Splunk alert ' +
        'on any use, and mandatory post-incident review within 24 hours. Governance replaces factor ' +
        'strength for the one identity class that cannot depend on the identity provider.',
      derivedFromFindingId: 'reviewer-constraint',
      targetEntityId: undefined,
      payload: {
        requirementId: 'AC-9',
        coversIdentityClasses: ['break_glass'],
        properties: [
          { kind: 'approval_workflow', approversRequired: 2, postIncidentReviewHours: 24 },
          { kind: 'monitoring_alert', destination: 'splunk', maxLatencyMinutes: 5 },
        ],
        implementationNotes:
          'Credentials sealed offline in the regional safe; retrieval requires two named approvers; ' +
          'every use alerts Splunk within five minutes and triggers a 24-hour review.',
      },
      provenance,
      status: 'pending',
    },
    {
      id: 'PROP-BG-exc',
      kind: 'exception_reapproval',
      title: 'EXC-11 rewritten against the compensating control, dated',
      rationale:
        'Break-glass remains exempt from CA-0031 by design. The exception is re-grounded on the ' +
        'compensating control rather than on an absence, and carries an expiry.',
      derivedFromFindingId: 'reviewer-constraint',
      targetEntityId: 'EXC-11',
      payload: { requiresReapproval: true, groundedOn: 'compensating control' },
      provenance,
      status: 'pending',
    },
  ];
}
