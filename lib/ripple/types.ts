/**
 * Throughline domain model.
 *
 * Design rules that everything downstream depends on:
 *
 * 1. Requirements, controls, tests and exceptions all express their substance as
 *    machine-comparable `Assertion` objects, not prose. That is what lets
 *    `analyze_change_impact` derive findings deterministically from the graph
 *    instead of pattern-matching strings. Prose still exists (`text`) — it is
 *    for humans, and it is never the input to analysis.
 * 2. Every edge carries provenance. An edge without provenance is a bug.
 * 3. Every entity carries `sourceSystem` / `sourceRef`. Throughline connects
 *    systems of record; it does not replace them.
 */

// ---------------------------------------------------------------------------
// Provenance / systems of record
// ---------------------------------------------------------------------------

export type SourceSystem =
  | "confluence"
  | "google_sheets"
  | "jira"
  | "azure_boards"
  | "sharepoint"
  | "github_actions"
  | "azure_pipelines"
  | "entra_id"
  | "okta"
  | "aws"
  | "azure"
  | "terraform_cloud"
  | "splunk"
  | "datadog"
  | "servicenow"
  | "vanta"
  | "throughline";

export interface SourceRef {
  system: SourceSystem;
  /** Native identifier in that system, e.g. "PLAT-4471", "RITM0084412". */
  ref: string;
  /** Optional human label, e.g. "Wexler Security Standard v4". */
  label?: string;
}

export type Origin = "human" | "agent";

export type LinkState = "proposed" | "approved";

export interface Provenance {
  /** Email of a person, or an agent identifier such as "agent:webmcp". */
  createdBy: string;
  origin: Origin;
  createdAt: IsoDate;
  /** Why this link exists. Read back verbatim by `explain_trace_link`. */
  rationale: string;
  /** What in a system of record supports the claim. */
  supportedBy?: SourceRef;
  /** When a human last confirmed the link still holds. */
  lastVerified?: IsoDate;
  state: LinkState;
}

/** ISO-8601 date, `YYYY-MM-DD`. Kept as a string so seed data stays readable. */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Identity classes — the vocabulary of `applicability` and scope expansion
// ---------------------------------------------------------------------------

/**
 * The classes of principal a requirement can apply to. Scope expansion is
 * computed by set-differencing a requirement's `applicability` across versions
 * and intersecting the result with the classes actually present in the graph.
 */
export type IdentityClass =
  | "human_privileged"
  | "human_standard"
  | "contractor"
  | "service_principal"
  | "managed_identity"
  | "ci_runner_identity"
  | "break_glass"
  | "third_party_integration";

export const ALL_IDENTITY_CLASSES: IdentityClass[] = [
  "human_privileged",
  "human_standard",
  "contractor",
  "service_principal",
  "managed_identity",
  "ci_runner_identity",
  "break_glass",
  "third_party_integration",
];

export type Environment = "production" | "gov_cloud" | "corporate" | "non_production";

// ---------------------------------------------------------------------------
// Assertions — the comparable substance of a requirement / control / test
// ---------------------------------------------------------------------------

export type AuthFactor =
  | "password"
  | "sms"
  | "totp"
  | "push"
  | "fido2"
  | "smartcard_piv"
  | "certificate"
  | "workload_federation";

/** Factors that survive a credential-phishing or relay attack. */
export const PHISHING_RESISTANT_FACTORS: AuthFactor[] = [
  "fido2",
  "smartcard_piv",
  "certificate",
  "workload_federation",
];

export type AssertionKind =
  | "auth_factor_policy"
  | "review_cadence"
  | "log_retention"
  | "credential_rotation"
  | "scan_cadence"
  | "approval_workflow"
  | "monitoring_alert";

interface AssertionBase {
  kind: AssertionKind;
  /** Which principals this assertion governs. Empty = inherits parent scope. */
  appliesTo?: IdentityClass[];
  environments?: Environment[];
  /** Human gloss, shown in the UI. Never parsed. */
  note?: string;
}

/** Which authentication factors are acceptable. */
export interface AuthFactorAssertion extends AssertionBase {
  kind: "auth_factor_policy";
  /** Factors the requirement permits, or the control actually accepts. */
  permittedFactors: AuthFactor[];
  /** True when the requirement demands phishing resistance explicitly. */
  requirePhishingResistant?: boolean;
  /** True when a weaker factor may be used if the strong one is unavailable. */
  allowsFallback?: boolean;
}

/** How often something must be re-reviewed, in days. */
export interface ReviewCadenceAssertion extends AssertionBase {
  kind: "review_cadence";
  /** Requirement: the maximum permitted gap. Control: the configured gap. */
  intervalDays: number;
}

export interface LogRetentionAssertion extends AssertionBase {
  kind: "log_retention";
  retentionDays: number;
  immutable?: boolean;
}

export interface CredentialRotationAssertion extends AssertionBase {
  kind: "credential_rotation";
  maxAgeDays: number;
}

export interface ScanCadenceAssertion extends AssertionBase {
  kind: "scan_cadence";
  intervalDays: number;
  severityThreshold?: "critical" | "high" | "medium";
}

export interface ApprovalWorkflowAssertion extends AssertionBase {
  kind: "approval_workflow";
  /** How many distinct humans must approve. Dual authorization = 2. */
  approversRequired: number;
  postIncidentReviewHours?: number;
}

export interface MonitoringAlertAssertion extends AssertionBase {
  kind: "monitoring_alert";
  /** Where the alert fires, e.g. splunk. */
  destination: SourceSystem;
  maxLatencyMinutes?: number;
}

export type Assertion =
  | AuthFactorAssertion
  | ReviewCadenceAssertion
  | LogRetentionAssertion
  | CredentialRotationAssertion
  | ScanCadenceAssertion
  | ApprovalWorkflowAssertion
  | MonitoringAlertAssertion;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind =
  | "standard"
  | "requirement"
  | "control"
  | "work_item"
  | "test"
  | "evidence"
  | "exception"
  | "decision";

export interface EntityBase {
  id: string;
  kind: EntityKind;
  title: string;
  sourceRef: SourceRef;
}

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type ApprovalStatus = "draft" | "in_review" | "approved" | "superseded";

export type VerificationMethod =
  | "automated_test"
  | "configuration_export"
  | "continuous_monitoring"
  | "manual_attestation"
  | "assessor_review";

export interface Standard extends EntityBase {
  kind: "standard";
  code: string;
  version: string;
  owner: string;
  frameworks: string[];
  requirementIds: string[];
}

/**
 * A requirement version. Editing text never overwrites: it appends a new
 * version and marks the prior one `superseded`. `RequirementVersion.id` is
 * unique per version; `requirementId` is stable across versions.
 */
export interface RequirementVersion extends EntityBase {
  kind: "requirement";
  requirementId: string;
  standardId: string;
  code: string;
  version: number;
  text: string;
  effectiveDate: IsoDate;
  owner: string;
  ownerTeam: Team;
  applicability: IdentityClass[];
  environments: Environment[];
  riskLevel: RiskLevel;
  verificationMethod: VerificationMethod;
  approvalStatus: ApprovalStatus;
  /** The comparable substance. Analysis reads this, never `text`. */
  assertions: Assertion[];
  supersedes?: string;
  changeSummary?: string;
}

export type Team =
  | "Platform Identity"
  | "Cloud SRE"
  | "Developer Experience"
  | "GRC"
  | "Gov Cloud";

export type ControlImplementationStatus =
  | "implemented"
  | "partially_implemented"
  | "planned"
  | "not_implemented";

export interface Control extends EntityBase {
  kind: "control";
  code: string;
  description: string;
  owner: string;
  ownerTeam: Team;
  implementationStatus: ControlImplementationStatus;
  /** Where the control is actually enforced, e.g. entra_id via terraform_cloud. */
  enforcedIn: SourceRef[];
  coversIdentityClasses: IdentityClass[];
  environments: Environment[];
  /** What the control actually does, in comparable form. */
  properties: Assertion[];
  lastReviewed?: IsoDate;
}

export type WorkStatus = "backlog" | "in_progress" | "in_review" | "done" | "blocked";

export interface WorkItem extends EntityBase {
  kind: "work_item";
  team: Team;
  sprint?: string;
  status: WorkStatus;
  assignee?: string;
  acceptanceCriteria: string[];
  /** Set by the impact engine when an upstream requirement changes. */
  staleReason?: string;
}

export interface TestDefinition extends EntityBase {
  kind: "test";
  runner: Extract<SourceSystem, "github_actions" | "azure_pipelines" | "vanta">;
  lastRun?: IsoDate;
  lastResult?: "pass" | "fail" | "not_run";
  /**
   * What the test actually asserts. Compared against a requirement's
   * assertions + verificationMethod to decide whether it still proves it.
   */
  assertions: Assertion[];
  verifies: VerificationMethod;
}

export interface Evidence extends EntityBase {
  kind: "evidence";
  evidenceType:
    | "attestation"
    | "configuration_export"
    | "plan_output"
    | "monitor_result"
    | "signoff";
  collectedAt: IsoDate;
  lastVerified: IsoDate;
  /** Days after which this evidence class is considered stale. */
  freshnessWindowDays: number;
  collectedBy: string;
}

export interface Exception extends EntityBase {
  kind: "exception";
  code: string;
  approver: string;
  approvedAt: IsoDate;
  expiresAt: IsoDate;
  reason: string;
  /** Which principals the carve-out covers. */
  appliesTo: IdentityClass[];
  environments: Environment[];
  /**
   * The relief actually granted, in comparable form — e.g. "permits totp".
   * Conflict detection compares these against the revised requirement.
   */
  grounds: Assertion[];
  /** Controls the exception carves an exemption out of. */
  exemptsControlIds: string[];
  status: "active" | "expired" | "revoked" | "requires_reapproval";
}

export interface Decision extends EntityBase {
  kind: "decision";
  decidedBy: string;
  decidedAt: IsoDate;
  rationale: string;
  approvalHistory: ApprovalEvent[];
  relatedEntityIds: string[];
}

export interface ApprovalEvent {
  actor: string;
  action: "proposed" | "approved" | "rejected" | "edited" | "reapproval_requested";
  at: IsoDate;
  note?: string;
}

export type Entity =
  | Standard
  | RequirementVersion
  | Control
  | WorkItem
  | TestDefinition
  | Evidence
  | Exception
  | Decision;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export type EdgeType =
  | "implements" // control -> requirement
  | "fulfills" // work_item -> control
  | "verifies" // test -> control | requirement
  | "evidences" // evidence -> control | test | work_item
  | "excepts" // exception -> requirement | control
  | "documents" // decision -> anything
  | "depends_on"; // work_item -> work_item

export interface TraceEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Proposals — what the agent may create, and only create
// ---------------------------------------------------------------------------

export type ProposalKind =
  | "control"
  | "control_update"
  | "work_item"
  | "trace_link"
  | "test_revision"
  | "exception_reapproval";

export type ProposalStatus = "pending" | "approved" | "rejected" | "edited";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  /** Groups proposals emitted by one `create_impact_review` call. */
  reviewId?: string;
  title: string;
  rationale: string;
  /** Which finding produced this, so the inbox can show the derivation. */
  derivedFromFindingId?: string;
  targetEntityId?: string;
  /** Shape depends on `kind`; validated at apply time, never blind-spread. */
  payload: Record<string, unknown>;
  provenance: Provenance;
  status: ProposalStatus;
  reviewedBy?: string;
  reviewedAt?: IsoDate;
  reviewNote?: string;
}

export interface ImpactReview {
  id: string;
  title: string;
  createdAt: IsoDate;
  createdBy: string;
  origin: Origin;
  requirementId: string;
  fromVersion: number;
  toVersion: number;
  findingIds: string[];
  proposalIds: string[];
  status: "open" | "closed";
}

// ---------------------------------------------------------------------------
// Findings — output of the impact engine
// ---------------------------------------------------------------------------

export type FindingKind =
  | "scope_expansion"
  | "control_insufficient"
  | "test_invalidated"
  | "exception_conflict"
  | "work_stale"
  | "coverage_gap"
  | "evidence_stale";

export type Severity = "info" | "low" | "moderate" | "high" | "critical";

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  requirementId: string;
  /** Entities the finding is about — highlighted in every view. */
  entityIds: string[];
  summary: string;
  /**
   * The derivation, machine-readable: which assertion was compared against
   * which, and what failed. `explain_trace_link` renders this back.
   */
  derivation: Derivation;
}

export interface Derivation {
  rule: string;
  /** e.g. "AC-2 v3 assertion auth_factor_policy.requirePhishingResistant=true". */
  expected: string;
  /** e.g. "CTL-114 permittedFactors includes totp, sms". */
  observed: string;
  comparedEntityIds: string[];
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface ReadinessComponent {
  key: "coverage" | "evidence_freshness" | "verification" | "exception_health" | "open_proposals";
  label: string;
  weight: number;
  /** 0..1 */
  score: number;
  detail: string;
}

export interface Readiness {
  /** 0..100, rounded. */
  score: number;
  components: ReadinessComponent[];
  formula: string;
}

// ---------------------------------------------------------------------------
// Graph snapshot
// ---------------------------------------------------------------------------

export interface GraphSnapshot {
  entities: Entity[];
  edges: TraceEdge[];
}
