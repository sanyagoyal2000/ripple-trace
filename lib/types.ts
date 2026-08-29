export type Status = 'covered' | 'affected' | 'gap' | 'expired';

export type Requirement = {
  id: string;
  title: string;
  statement: string;
  previousStatement?: string;
  version: number;
  owner: string;
  effectiveDate: string;
  status: Status;
};

export type Control = { id: string; title: string; requirementId: string; owner: string; status: Status };
export type WorkItem = { id: string; title: string; controlId: string; owner: string; sprint: string; status: 'Backlog' | 'In progress' | 'Completed'; provenance: 'human' | 'agent'; acceptanceCriteria: string[] };
export type Evidence = { id: string; title: string; controlId: string; source: string; collectedAt: string; expiresAt: string; status: 'valid' | 'expired' };
export type PolicyException = { id: string; title: string; requirementId: string; reason: string; expiresAt: string; status: 'approved' | 'needs-review' };
export type Proposal = { id: string; kind: 'control' | 'work' | 'test' | 'exception'; title: string; reason: string; targetId: string; status: 'pending' | 'approved' | 'rejected' };
export type Decision = { id: string; action: string; actor: string; timestamp: string; rationale: string };

export type DemoState = {
  requirements: Requirement[];
  controls: Control[];
  workItems: WorkItem[];
  evidence: Evidence[];
  exceptions: PolicyException[];
  proposals: Proposal[];
  decisions: Decision[];
  analyzed: boolean;
};
