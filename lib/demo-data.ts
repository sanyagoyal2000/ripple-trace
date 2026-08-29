import type { DemoState } from './types';

export const INITIAL_STATE: DemoState = {
  requirements: [
    { id: 'IDS-01', title: 'Privileged authentication', statement: 'Administrators must use multi-factor authentication.', version: 1, owner: 'Security Governance', effectiveDate: '2026-07-01', status: 'covered' },
    { id: 'IDS-02', title: 'Periodic access review', statement: 'Privileged access must be reviewed annually.', version: 1, owner: 'Identity Team', effectiveDate: '2026-07-01', status: 'covered' },
    { id: 'IDS-03', title: 'Dormant account removal', statement: 'Dormant privileged accounts must be disabled within 30 days.', version: 1, owner: 'Identity Team', effectiveDate: '2026-07-01', status: 'covered' },
    { id: 'IDS-04', title: 'Emergency access', statement: 'Emergency access must be documented and monitored.', version: 1, owner: 'Security Operations', effectiveDate: '2026-07-01', status: 'covered' },
    { id: 'IDS-05', title: 'Evidence retention', statement: 'Authentication evidence must be retained for one year.', version: 1, owner: 'Compliance', effectiveDate: '2026-07-01', status: 'covered' },
  ],
  controls: [
    { id: 'CTRL-MFA-01', title: 'MFA enrollment enforcement', requirementId: 'IDS-01', owner: 'Identity Platform', status: 'covered' },
    { id: 'CTRL-REV-01', title: 'Annual privileged access review', requirementId: 'IDS-02', owner: 'Identity Governance', status: 'covered' },
    { id: 'CTRL-DOR-01', title: 'Dormant account automation', requirementId: 'IDS-03', owner: 'Identity Platform', status: 'covered' },
    { id: 'CTRL-BRG-01', title: 'Break-glass account monitoring', requirementId: 'IDS-04', owner: 'Security Operations', status: 'covered' },
  ],
  workItems: [
    { id: 'WORK-37', title: 'Enforce MFA for administrator accounts', controlId: 'CTRL-MFA-01', owner: 'Identity Team', sprint: 'Sprint 42', status: 'Completed', provenance: 'human', acceptanceCriteria: ['All administrator accounts are enrolled', 'SMS and authenticator applications are permitted'] },
    { id: 'WORK-41', title: 'Automate annual access review export', controlId: 'CTRL-REV-01', owner: 'Governance Team', sprint: 'Sprint 42', status: 'Completed', provenance: 'human', acceptanceCriteria: ['Generate annual owner review report'] },
    { id: 'WORK-48', title: 'Disable dormant privileged accounts', controlId: 'CTRL-DOR-01', owner: 'Identity Team', sprint: 'Sprint 43', status: 'In progress', provenance: 'human', acceptanceCriteria: ['Disable accounts after 30 days of inactivity'] },
    { id: 'WORK-52', title: 'Document emergency access workflow', controlId: 'CTRL-BRG-01', owner: 'Security Operations', sprint: 'Sprint 43', status: 'Backlog', provenance: 'human', acceptanceCriteria: ['Document request and approval path'] },
  ],
  evidence: [
    { id: 'EVD-104', title: 'MFA enrollment export', controlId: 'CTRL-MFA-01', source: 'Simulated identity provider', collectedAt: '2026-07-01', expiresAt: '2026-10-01', status: 'valid' },
    { id: 'EVD-108', title: 'Annual access review report', controlId: 'CTRL-REV-01', source: 'Simulated governance system', collectedAt: '2025-09-01', expiresAt: '2026-09-01', status: 'expired' },
  ],
  exceptions: [{ id: 'EXC-12', title: 'Contractor SMS exception', requirementId: 'IDS-01', reason: 'Hardware keys not yet issued to contractors.', expiresAt: '2026-12-31', status: 'approved' }],
  proposals: [],
  decisions: [{ id: 'DEC-001', action: 'Approved IDS v1.0', actor: 'Avery Morgan', timestamp: '2026-07-01 09:30', rationale: 'Initial identity standard approved for rollout.' }],
  analyzed: false,
};

export const REVISED_STATEMENT = 'All privileged human accounts must use phishing-resistant authentication. Privileged access must be reviewed every 90 days.';

export const IMPACT_PROPOSALS = [
  { id: 'PROP-01', kind: 'control' as const, title: 'Upgrade MFA control to phishing-resistant methods', reason: 'SMS and authenticator applications do not satisfy the revised requirement.', targetId: 'CTRL-MFA-01', status: 'pending' as const },
  { id: 'PROP-02', kind: 'work' as const, title: 'Issue passkeys to privileged workforce', reason: 'Current implementation permits methods outside the approved capability set.', targetId: 'WORK-NEW-01', status: 'pending' as const },
  { id: 'PROP-03', kind: 'work' as const, title: 'Move access reviews from annual to quarterly', reason: 'The current control cadence is 275 days longer than permitted.', targetId: 'WORK-NEW-02', status: 'pending' as const },
  { id: 'PROP-04', kind: 'test' as const, title: 'Verify phishing-resistant factor enrollment', reason: 'Existing evidence proves MFA enrollment, but not factor strength.', targetId: 'TEST-NEW-01', status: 'pending' as const },
  { id: 'PROP-05', kind: 'exception' as const, title: 'Reassess contractor SMS exception', reason: 'The approved exception directly conflicts with the revised authentication requirement.', targetId: 'EXC-12', status: 'pending' as const },
];
