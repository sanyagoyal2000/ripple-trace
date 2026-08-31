/**
 * Wexler Systems, continued.
 *
 * Breadth added deliberately rather than for volume: four more requirements
 * across identity, network, personnel and media, each with the controls, work,
 * tests and evidence a real programme would have hung off it — plus one more
 * exception and the architecture decisions that explain why two of these
 * controls look the way they do.
 *
 * The point of the extra breadth is that `analyze_change_impact` has to find
 * the AC-2 consequences inside a graph large enough that a person could not
 * hold it in their head — including CTL-175, which governs an identity class
 * AC-2 v3 newly covers while being linked to a different requirement entirely.
 */

import type {
  Control,
  Decision,
  Evidence,
  Exception,
  Provenance,
  RequirementVersion,
  TestDefinition,
  TraceEdge,
  WorkItem,
} from './types';

const GRC_LEAD = 'd.lindqvist@wexler.example';
const IDENTITY_LEAD = 'p.okafor@wexler.example';
const SRE_LEAD = 'm.varga@wexler.example';
const DEVEX_LEAD = 's.raghunathan@wexler.example';
const GOV_LEAD = 't.mbeki@wexler.example';
const PEOPLE_LEAD = 'a.ferreira@wexler.example';

function human(
  createdBy: string,
  createdAt: string,
  rationale: string,
  supportedBy?: Provenance['supportedBy'],
  lastVerified?: string,
): Provenance {
  return { createdBy, origin: 'human', createdAt, rationale, supportedBy, lastVerified, state: 'approved' };
}

export const extraRequirements: RequirementVersion[] = [
  {
    id: 'IA-5@1',
    kind: 'requirement',
    requirementId: 'IA-5',
    standardId: 'STD-WSEC-1',
    code: 'IA-5',
    version: 1,
    title: 'Authenticator and secret management',
    text: 'Shared and privileged secrets must be held in a managed vault and rotated at least every 60 days.',
    effectiveDate: '2025-10-01',
    owner: IDENTITY_LEAD,
    ownerTeam: 'Platform Identity',
    applicability: ['human_privileged', 'service_principal', 'break_glass'],
    environments: ['production', 'gov_cloud'],
    riskLevel: 'high',
    verificationMethod: 'configuration_export',
    approvalStatus: 'approved',
    assertions: [{ kind: 'credential_rotation', maxAgeDays: 60 }],
    sourceRef: { system: 'confluence', ref: 'WSEC/pages/884261' },
  },
  {
    id: 'SC-7@1',
    kind: 'requirement',
    requirementId: 'SC-7',
    standardId: 'STD-WSEC-1',
    code: 'SC-7',
    version: 1,
    title: 'Network boundary protection',
    text: 'Production network boundaries must be defined as code and reviewed at least every 60 days.',
    effectiveDate: '2025-04-15',
    owner: SRE_LEAD,
    ownerTeam: 'Cloud SRE',
    applicability: ['service_principal', 'managed_identity'],
    environments: ['production', 'gov_cloud'],
    riskLevel: 'high',
    verificationMethod: 'continuous_monitoring',
    approvalStatus: 'approved',
    assertions: [
      { kind: 'review_cadence', intervalDays: 60 },
      { kind: 'monitoring_alert', destination: 'datadog', maxLatencyMinutes: 30 },
    ],
    sourceRef: { system: 'confluence', ref: 'WSEC/pages/884266' },
  },
  {
    id: 'PS-4@1',
    kind: 'requirement',
    requirementId: 'PS-4',
    standardId: 'STD-WSEC-1',
    code: 'PS-4',
    version: 1,
    title: 'Personnel termination and access removal',
    text: 'Access for departing personnel and contractors must be revoked within 24 hours and attested quarterly.',
    effectiveDate: '2025-12-01',
    owner: PEOPLE_LEAD,
    ownerTeam: 'GRC',
    applicability: ['human_privileged', 'human_standard', 'contractor'],
    environments: ['production', 'corporate'],
    riskLevel: 'moderate',
    verificationMethod: 'manual_attestation',
    approvalStatus: 'approved',
    assertions: [{ kind: 'review_cadence', intervalDays: 90 }],
    sourceRef: { system: 'confluence', ref: 'WSEC/pages/884271' },
  },
  {
    id: 'MP-6@1',
    kind: 'requirement',
    requirementId: 'MP-6',
    standardId: 'STD-WSEC-1',
    code: 'MP-6',
    version: 1,
    title: 'Media sanitization',
    text: 'Decommissioned storage media holding customer data must be cryptographically erased and certified.',
    effectiveDate: '2025-02-01',
    owner: SRE_LEAD,
    ownerTeam: 'Cloud SRE',
    applicability: ['service_principal'],
    environments: ['production'],
    riskLevel: 'low',
    verificationMethod: 'manual_attestation',
    approvalStatus: 'approved',
    assertions: [{ kind: 'review_cadence', intervalDays: 365 }],
    sourceRef: { system: 'confluence', ref: 'WSEC/pages/884276' },
  },
];

export const extraControls: Control[] = [
  {
    id: 'CTL-175',
    kind: 'control',
    code: 'CTL-175',
    title: 'Privileged secret vaulting',
    description:
      'Shared privileged secrets and break-glass credentials are held in HashiCorp Vault with ' +
      'brokered checkout. Rotation runs on a 60-day schedule.',
    owner: IDENTITY_LEAD,
    ownerTeam: 'Platform Identity',
    implementationStatus: 'implemented',
    enforcedIn: [
      { system: 'aws', ref: 'vault-prod-privileged' },
      { system: 'terraform_cloud', ref: 'wexler-identity-prod' },
    ],
    // Governs break_glass — a class AC-2 v3 newly covers — while implementing
    // IA-5, not AC-2. Exactly the kind of control a person forgets to check,
    // and the analyzer finds it by scanning identity classes, not links.
    coversIdentityClasses: ['human_privileged', 'service_principal', 'break_glass'],
    environments: ['production', 'gov_cloud'],
    properties: [
      { kind: 'credential_rotation', maxAgeDays: 60 },
      {
        // Checkout is gated by a vault passphrase, deliberately independent of
        // the identity provider. Harmless under IA-5, which says nothing about
        // factor strength — and the reason this control surfaces the moment
        // AC-2 v3 extends phishing resistance to break-glass identities.
        kind: 'auth_factor_policy',
        permittedFactors: ['password'],
        allowsFallback: false,
        appliesTo: ['break_glass'],
        environments: ['production', 'gov_cloud'],
        note: 'Vault passphrase checkout, independent of Entra ID by design.',
      },
    ],
    lastReviewed: '2026-07-28',
    sourceRef: { system: 'google_sheets', ref: 'SOC2-matrix!B175' },
  },
  {
    id: 'CTL-181',
    kind: 'control',
    code: 'CTL-181',
    title: 'Network boundary as code',
    description: 'Security groups and Azure NSGs are declared in Terraform with drift alerting to Datadog.',
    owner: SRE_LEAD,
    ownerTeam: 'Cloud SRE',
    implementationStatus: 'implemented',
    enforcedIn: [
      { system: 'terraform_cloud', ref: 'wexler-network-prod' },
      { system: 'datadog', ref: 'monitor-network-drift' },
    ],
    coversIdentityClasses: ['service_principal', 'managed_identity'],
    environments: ['production', 'gov_cloud'],
    properties: [
      { kind: 'review_cadence', intervalDays: 30 },
      { kind: 'monitoring_alert', destination: 'datadog', maxLatencyMinutes: 15 },
    ],
    lastReviewed: '2026-08-12',
    sourceRef: { system: 'google_sheets', ref: 'SOC2-matrix!B181' },
  },
  {
    id: 'CTL-190',
    kind: 'control',
    code: 'CTL-190',
    title: 'Joiner-mover-leaver automation',
    description:
      'Workday termination events drive deprovisioning in Entra ID within four hours. Okta accounts ' +
      'in the acquired business unit are still handled by a manual ticket.',
    owner: PEOPLE_LEAD,
    ownerTeam: 'GRC',
    implementationStatus: 'partially_implemented',
    enforcedIn: [
      { system: 'entra_id', ref: 'lifecycle-workflow-term' },
      { system: 'servicenow', ref: 'CAT-ITEM-offboard' },
    ],
    coversIdentityClasses: ['human_privileged', 'human_standard'],
    environments: ['production', 'corporate'],
    properties: [{ kind: 'review_cadence', intervalDays: 90 }],
    lastReviewed: '2026-06-30',
    sourceRef: { system: 'google_sheets', ref: 'SOC2-matrix!B190' },
  },
];

export const extraWorkItems: WorkItem[] = [
  {
    id: 'WI-PLAT-4520',
    kind: 'work_item',
    title: 'Broker break-glass checkout through Vault with dual approval',
    team: 'Platform Identity',
    sprint: 'PI-2026.18',
    status: 'in_progress',
    assignee: IDENTITY_LEAD,
    acceptanceCriteria: [
      'Break-glass checkout requires two named approvers',
      'Every checkout emits a Splunk event within five minutes',
    ],
    sourceRef: { system: 'jira', ref: 'PLAT-4520' },
  },
  {
    id: 'WI-SRE-3418',
    kind: 'work_item',
    title: 'Move Gov network boundaries into the Terraform workspace',
    team: 'Gov Cloud',
    status: 'in_progress',
    assignee: GOV_LEAD,
    acceptanceCriteria: ['No Gov NSG is modified outside Terraform'],
    sourceRef: { system: 'azure_boards', ref: '13140' },
  },
  {
    id: 'WI-GRC-902',
    kind: 'work_item',
    title: 'Automate Okta deprovisioning for the acquired business unit',
    team: 'GRC',
    status: 'backlog',
    acceptanceCriteria: ['Termination in Workday revokes Okta access within 24 hours'],
    sourceRef: { system: 'jira', ref: 'GRC-902' },
  },
  {
    id: 'WI-DEVEX-2261',
    kind: 'work_item',
    title: 'Publish signed SBOMs for production images',
    team: 'Developer Experience',
    status: 'in_review',
    assignee: DEVEX_LEAD,
    acceptanceCriteria: ['Every release publishes an attested SBOM'],
    sourceRef: { system: 'jira', ref: 'DEVEX-2261' },
  },
  {
    id: 'WI-SRE-3440',
    kind: 'work_item',
    title: 'Certify cryptographic erase for decommissioned NVMe fleet',
    team: 'Cloud SRE',
    status: 'done',
    assignee: SRE_LEAD,
    acceptanceCriteria: ['Erase certificates filed for every returned device'],
    sourceRef: { system: 'jira', ref: 'SRE-3440' },
  },
];

export const extraTests: TestDefinition[] = [
  {
    id: 'test-vault-secret-age',
    kind: 'test',
    title: 'No vaulted privileged secret older than 60 days',
    runner: 'github_actions',
    lastRun: '2026-08-26',
    lastResult: 'pass',
    verifies: 'configuration_export',
    assertions: [{ kind: 'credential_rotation', maxAgeDays: 60 }],
    sourceRef: { system: 'github_actions', ref: 'wexler/identity/.github/workflows/vault-age.yml' },
  },
  {
    id: 'test-network-drift',
    kind: 'test',
    title: 'Network boundary drift reconciled within 30 days',
    runner: 'azure_pipelines',
    lastRun: '2026-08-22',
    lastResult: 'pass',
    verifies: 'continuous_monitoring',
    assertions: [{ kind: 'review_cadence', intervalDays: 30 }],
    sourceRef: { system: 'azure_pipelines', ref: 'wexler-gov/network-drift' },
  },
  {
    id: 'test-offboard-latency',
    kind: 'test',
    title: 'Termination events deprovision within 24 hours',
    runner: 'vanta',
    lastRun: '2026-08-19',
    lastResult: 'fail',
    verifies: 'continuous_monitoring',
    assertions: [{ kind: 'review_cadence', intervalDays: 90 }],
    sourceRef: { system: 'vanta', ref: 'monitor-offboarding-latency' },
  },
];

export const extraEvidence: Evidence[] = [
  {
    id: 'EV-10',
    kind: 'evidence',
    title: 'Vault rotation report — privileged namespace',
    evidenceType: 'configuration_export',
    collectedAt: '2026-08-26',
    lastVerified: '2026-08-26',
    freshnessWindowDays: 60,
    collectedBy: IDENTITY_LEAD,
    sourceRef: { system: 'aws', ref: 'vault/reports/2026-08-26' },
  },
  {
    id: 'EV-11',
    kind: 'evidence',
    title: 'Datadog network drift monitor history',
    evidenceType: 'monitor_result',
    collectedAt: '2026-08-22',
    lastVerified: '2026-08-22',
    freshnessWindowDays: 30,
    collectedBy: SRE_LEAD,
    sourceRef: { system: 'datadog', ref: 'monitor-network-drift/history' },
  },
  {
    id: 'EV-12',
    kind: 'evidence',
    title: 'Quarterly offboarding attestation',
    evidenceType: 'signoff',
    collectedAt: '2026-03-31',
    lastVerified: '2026-03-31',
    freshnessWindowDays: 90,
    collectedBy: PEOPLE_LEAD,
    sourceRef: { system: 'servicenow', ref: 'RITM0082044' },
  },
  {
    id: 'EV-13',
    kind: 'evidence',
    title: 'Cryptographic erase certificates — NVMe return batch 41',
    evidenceType: 'attestation',
    collectedAt: '2026-05-18',
    lastVerified: '2026-05-18',
    freshnessWindowDays: 365,
    collectedBy: SRE_LEAD,
    sourceRef: { system: 'servicenow', ref: 'RITM0083120' },
  },
];

export const extraExceptions: Exception[] = [
  {
    id: 'EXC-14',
    kind: 'exception',
    code: 'EXC-14',
    title: 'Manual Okta deprovisioning in the acquired business unit',
    approver: GRC_LEAD,
    approvedAt: '2026-05-02',
    expiresAt: '2026-11-30',
    reason:
      'Workday does not yet drive Okta in the acquired business unit. Deprovisioning runs from a ' +
      'ServiceNow ticket with a 24-hour target until GRC-902 lands.',
    appliesTo: ['human_standard', 'contractor'],
    environments: ['production', 'corporate'],
    // The relief is the manual route, not a slower cadence: the quarterly
    // attestation PS-4 asks for still applies, so this carve-out is clean
    // against today's requirements and only becomes interesting if PS-4 tightens.
    grounds: [{ kind: 'review_cadence', intervalDays: 90, appliesTo: ['contractor', 'human_standard'] }],
    exemptsControlIds: ['CTL-190'],
    status: 'active',
    sourceRef: { system: 'servicenow', ref: 'RITM0085001' },
  },
];

export const extraDecisions: Decision[] = [
  {
    id: 'DEC-31',
    kind: 'decision',
    title: 'Vault brokers privileged secrets rather than Entra ID',
    decidedBy: IDENTITY_LEAD,
    decidedAt: '2025-09-30',
    rationale:
      'Secret custody is deliberately separated from the identity provider so that a provider ' +
      'outage does not also remove access to the credentials needed to recover from it.',
    approvalHistory: [
      { actor: IDENTITY_LEAD, action: 'proposed', at: '2025-09-12' },
      { actor: SRE_LEAD, action: 'approved', at: '2025-09-30' },
    ],
    relatedEntityIds: ['CTL-175', 'IA-5', 'AC-9'],
    sourceRef: { system: 'sharepoint', ref: 'ADR/2025-09-vault-custody' },
  },
  {
    id: 'DEC-34',
    kind: 'decision',
    title: 'Offboarding automation deferred for the acquired business unit',
    decidedBy: GRC_LEAD,
    decidedAt: '2026-05-02',
    rationale:
      'Sequenced behind the Gov Cloud authorization. Manual deprovisioning is accepted under EXC-14 ' +
      'with a dated expiry rather than left undocumented.',
    approvalHistory: [
      { actor: PEOPLE_LEAD, action: 'proposed', at: '2026-04-20' },
      { actor: GRC_LEAD, action: 'approved', at: '2026-05-02' },
    ],
    relatedEntityIds: ['CTL-190', 'EXC-14', 'PS-4'],
    sourceRef: { system: 'sharepoint', ref: 'ADR/2026-05-offboarding' },
  },
];

export const extraEdges: TraceEdge[] = [
  { id: 'E-011', type: 'implements', from: 'CTL-175', to: 'IA-5', provenance: human(IDENTITY_LEAD, '2025-10-04', 'Vault rotation is the IA-5 enforcement point.', { system: 'google_sheets', ref: 'SOC2-matrix!B175' }, '2026-07-28') },
  { id: 'E-012', type: 'implements', from: 'CTL-181', to: 'SC-7', provenance: human(SRE_LEAD, '2025-04-20', 'Boundary-as-code satisfies the SC-7 reconciliation window.', undefined, '2026-08-12') },
  { id: 'E-013', type: 'implements', from: 'CTL-190', to: 'PS-4', provenance: human(PEOPLE_LEAD, '2025-12-08', 'Lifecycle workflow performs the PS-4 revocation.', undefined, '2026-06-30') },
  { id: 'E-014', type: 'implements', from: 'CTL-133', to: 'MP-6', provenance: human(SRE_LEAD, '2025-02-14', 'Erase certificates are retained under the audit retention control.', undefined, '2026-07-02') },

  { id: 'E-111', type: 'verifies', from: 'test-vault-secret-age', to: 'CTL-175', provenance: human(IDENTITY_LEAD, '2025-10-10', 'Age check proves rotation is effective, not merely scheduled.', undefined, '2026-08-26') },
  { id: 'E-112', type: 'verifies', from: 'test-network-drift', to: 'CTL-181', provenance: human(SRE_LEAD, '2025-05-02', 'Pipeline fails when boundary drift outlives the window.', undefined, '2026-08-22') },
  { id: 'E-113', type: 'verifies', from: 'test-offboard-latency', to: 'CTL-190', provenance: human(PEOPLE_LEAD, '2026-01-15', 'Monitor measures real deprovisioning latency against the 24-hour target.', undefined, '2026-08-19') },

  { id: 'E-221', type: 'fulfills', from: 'WI-PLAT-4520', to: 'CTL-175', provenance: human(IDENTITY_LEAD, '2026-07-30', 'Dual-approval checkout is the missing half of brokered custody.') },
  { id: 'E-222', type: 'fulfills', from: 'WI-SRE-3418', to: 'CTL-181', provenance: human(GOV_LEAD, '2026-06-18', 'Brings Gov boundaries under the same workspace.') },
  { id: 'E-223', type: 'fulfills', from: 'WI-GRC-902', to: 'CTL-190', provenance: human(GRC_LEAD, '2026-05-02', 'Closes the manual gap EXC-14 currently covers.') },
  { id: 'E-224', type: 'fulfills', from: 'WI-SRE-3440', to: 'CTL-133', provenance: human(SRE_LEAD, '2026-05-18', 'Erase certification files the MP-6 evidence.', undefined, '2026-05-18') },

  { id: 'E-311', type: 'evidences', from: 'EV-10', to: 'CTL-175', provenance: human(IDENTITY_LEAD, '2026-08-26', 'Rotation report for the privileged namespace.', undefined, '2026-08-26') },
  { id: 'E-312', type: 'evidences', from: 'EV-11', to: 'CTL-181', provenance: human(SRE_LEAD, '2026-08-22', 'Monitor history showing drift and resolution times.', undefined, '2026-08-22') },
  { id: 'E-313', type: 'evidences', from: 'EV-12', to: 'CTL-190', provenance: human(PEOPLE_LEAD, '2026-03-31', 'Quarterly attestation for the offboarding queue.', undefined, '2026-03-31') },
  { id: 'E-314', type: 'evidences', from: 'EV-13', to: 'CTL-133', provenance: human(SRE_LEAD, '2026-05-18', 'Certificates for the returned device batch.', undefined, '2026-05-18') },

  { id: 'E-411', type: 'excepts', from: 'EXC-14', to: 'CTL-190', provenance: human(GRC_LEAD, '2026-05-02', 'Manual deprovisioning accepted with a dated expiry.', { system: 'servicenow', ref: 'RITM0085001' }, '2026-05-02') },

  { id: 'E-511', type: 'documents', from: 'DEC-31', to: 'CTL-175', provenance: human(IDENTITY_LEAD, '2025-09-30', 'Why secret custody sits outside the identity provider.') },
  { id: 'E-512', type: 'documents', from: 'DEC-34', to: 'CTL-190', provenance: human(GRC_LEAD, '2026-05-02', 'Why offboarding automation is sequenced after Gov Cloud.') },

  { id: 'E-241', type: 'depends_on', from: 'WI-GRC-902', to: 'WI-AB-13002', provenance: human(GRC_LEAD, '2026-05-06', 'Both depend on the same tenant onboarding work.') },
];
