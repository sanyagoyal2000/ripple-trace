/**
 * Seed data: Wexler Systems.
 *
 * Fictional enterprise software company, ~40k employees, founded 2004 — old
 * enough to have acquired two of everything. The *tooling* is real, and that is
 * the point: Throughline connects systems of record, it does not replace them.
 * Nothing here is a live integration; these are represented systems.
 *
 * Two latent gaps are planted in the data, never in code:
 *   - CTL-114 still permits TOTP and SMS fallback.
 *   - CTL-118 runs on an annual cadence.
 * Neither is a problem against today's requirements. Both become findings the
 * moment AC-2 demands phishing resistance and a 90-day review, and the analyzer
 * must discover that by comparing assertions — never by matching a string.
 */

import type {
  Control,
  Decision,
  Evidence,
  Exception,
  GraphSnapshot,
  IsoDate,
  Provenance,
  RequirementVersion,
  Standard,
  TestDefinition,
  TraceEdge,
  WorkItem,
} from "./types";

/** Demo "today". Fixed so readiness and staleness are reproducible for judges. */
export const DEMO_TODAY: IsoDate = "2026-08-29";

const GRC_LEAD = "d.lindqvist@wexler.example";
const IDENTITY_LEAD = "p.okafor@wexler.example";
const SRE_LEAD = "m.varga@wexler.example";
const DEVEX_LEAD = "s.raghunathan@wexler.example";
const GOV_LEAD = "t.mbeki@wexler.example";

function human(
  createdBy: string,
  createdAt: IsoDate,
  rationale: string,
  supportedBy?: Provenance["supportedBy"],
  lastVerified?: IsoDate,
): Provenance {
  return {
    createdBy,
    origin: "human",
    createdAt,
    rationale,
    supportedBy,
    lastVerified,
    state: "approved",
  };
}

// ---------------------------------------------------------------------------
// Standard
// ---------------------------------------------------------------------------

export const seedStandard: Standard = {
  id: "STD-WSEC-1",
  kind: "standard",
  code: "WSEC-1",
  title: "Wexler Security Standard",
  version: "4.2",
  owner: GRC_LEAD,
  frameworks: ["SOC 2 Type II", "ISO/IEC 27001:2022", "FedRAMP Moderate (in progress)"],
  sourceRef: { system: "confluence", ref: "WSEC/pages/884211", label: "Wexler Security Standard v4.2" },
  requirementIds: ["AC-2", "AC-5", "AC-9", "SC-4", "AU-3", "SR-2", "CM-6", "RA-5", "CP-9", "IR-4"],
};

// ---------------------------------------------------------------------------
// Requirements. AC-2 carries real version history; the demo change adds v3.
// ---------------------------------------------------------------------------

export const seedRequirements: RequirementVersion[] = [
  {
    id: "AC-2@1",
    kind: "requirement",
    requirementId: "AC-2",
    standardId: "STD-WSEC-1",
    code: "AC-2",
    version: 1,
    title: "Privileged access authentication",
    text: "Administrative access to production systems must require multi-factor authentication.",
    effectiveDate: "2023-04-01",
    owner: IDENTITY_LEAD,
    ownerTeam: "Platform Identity",
    applicability: ["human_privileged"],
    environments: ["production"],
    riskLevel: "critical",
    verificationMethod: "automated_test",
    approvalStatus: "superseded",
    assertions: [
      {
        kind: "auth_factor_policy",
        permittedFactors: ["password", "sms", "totp", "push", "fido2", "smartcard_piv"],
        requirePhishingResistant: false,
        allowsFallback: true,
        appliesTo: ["human_privileged"],
        environments: ["production"],
        note: "Any second factor accepted.",
      },
    ],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884215" },
  },
  {
    id: "AC-2@2",
    kind: "requirement",
    requirementId: "AC-2",
    standardId: "STD-WSEC-1",
    code: "AC-2",
    version: 2,
    title: "Privileged access authentication",
    text:
      "All privileged human access to production infrastructure must be authenticated with " +
      "multi-factor authentication. Contractor administrators are in scope. Factor strength is " +
      "governed by the Identity Standard; fallback factors are permitted where a hardware " +
      "authenticator is unavailable.",
    effectiveDate: "2026-01-15",
    owner: IDENTITY_LEAD,
    ownerTeam: "Platform Identity",
    applicability: ["human_privileged", "contractor"],
    environments: ["production", "gov_cloud"],
    riskLevel: "critical",
    verificationMethod: "automated_test",
    approvalStatus: "approved",
    supersedes: "AC-2@1",
    changeSummary: "Extended to contractor administrators and Gov Cloud workloads.",
    assertions: [
      {
        kind: "auth_factor_policy",
        permittedFactors: ["sms", "totp", "push", "fido2", "smartcard_piv"],
        requirePhishingResistant: false,
        allowsFallback: true,
        appliesTo: ["human_privileged", "contractor"],
        environments: ["production", "gov_cloud"],
        note: "MFA required; factor type unconstrained.",
      },
    ],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884215" },
  },
  {
    id: "AC-5@1",
    kind: "requirement",
    requirementId: "AC-5",
    standardId: "STD-WSEC-1",
    code: "AC-5",
    version: 1,
    title: "Access review cadence",
    text: "Entitlements granting production access must be reviewed and recertified at least annually.",
    effectiveDate: "2025-07-01",
    owner: GRC_LEAD,
    ownerTeam: "GRC",
    applicability: ["human_privileged", "human_standard", "contractor"],
    environments: ["production", "gov_cloud"],
    riskLevel: "high",
    verificationMethod: "manual_attestation",
    approvalStatus: "approved",
    assertions: [
      { kind: "review_cadence", intervalDays: 365, note: "Annual recertification." },
    ],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884219" },
  },
  {
    id: "AC-9@1",
    kind: "requirement",
    requirementId: "AC-9",
    standardId: "STD-WSEC-1",
    code: "AC-9",
    version: 1,
    title: "Emergency (break-glass) access",
    text:
      "Break-glass credentials for regional control planes must be retrievable without dependence " +
      "on the primary identity provider, and every use must be alerted and reviewed.",
    effectiveDate: "2025-02-10",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    applicability: ["break_glass"],
    environments: ["production", "gov_cloud"],
    riskLevel: "critical",
    verificationMethod: "manual_attestation",
    approvalStatus: "approved",
    assertions: [
      { kind: "monitoring_alert", destination: "splunk", maxLatencyMinutes: 15 },
      { kind: "approval_workflow", approversRequired: 1, postIncidentReviewHours: 72 },
    ],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884224" },
  },
  {
    id: "SC-4@1",
    kind: "requirement",
    requirementId: "SC-4",
    standardId: "STD-WSEC-1",
    code: "SC-4",
    version: 1,
    title: "Secrets and workload identity",
    text: "Workload credentials must be short-lived and rotated at least every 90 days.",
    effectiveDate: "2025-09-01",
    owner: IDENTITY_LEAD,
    ownerTeam: "Platform Identity",
    applicability: ["service_principal", "managed_identity", "ci_runner_identity"],
    environments: ["production", "gov_cloud", "non_production"],
    riskLevel: "high",
    verificationMethod: "configuration_export",
    approvalStatus: "approved",
    assertions: [{ kind: "credential_rotation", maxAgeDays: 90 }],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884231" },
  },
  {
    id: "AU-3@1",
    kind: "requirement",
    requirementId: "AU-3",
    standardId: "STD-WSEC-1",
    code: "AU-3",
    version: 1,
    title: "Audit log retention",
    text: "Security-relevant audit logs must be retained immutably for at least 365 days.",
    effectiveDate: "2024-11-01",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    applicability: ["human_privileged", "service_principal", "break_glass"],
    environments: ["production", "gov_cloud"],
    riskLevel: "high",
    verificationMethod: "continuous_monitoring",
    approvalStatus: "approved",
    assertions: [{ kind: "log_retention", retentionDays: 365, immutable: true }],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884236" },
  },
  {
    id: "SR-2@1",
    kind: "requirement",
    requirementId: "SR-2",
    standardId: "STD-WSEC-1",
    code: "SR-2",
    version: 1,
    title: "Third-party and contractor access",
    text: "Contractor and third-party integration access must be time-bound and reviewed semi-annually.",
    effectiveDate: "2025-05-15",
    owner: GRC_LEAD,
    ownerTeam: "GRC",
    applicability: ["contractor", "third_party_integration"],
    environments: ["production", "corporate"],
    riskLevel: "moderate",
    verificationMethod: "manual_attestation",
    approvalStatus: "approved",
    assertions: [{ kind: "review_cadence", intervalDays: 180 }],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884240" },
  },
  {
    id: "CM-6@1",
    kind: "requirement",
    requirementId: "CM-6",
    standardId: "STD-WSEC-1",
    code: "CM-6",
    version: 1,
    title: "Infrastructure configuration baselines",
    text: "Production infrastructure must be declared as code and drift detected within 30 days.",
    effectiveDate: "2025-03-01",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    applicability: ["service_principal", "managed_identity"],
    environments: ["production", "gov_cloud"],
    riskLevel: "moderate",
    verificationMethod: "continuous_monitoring",
    approvalStatus: "approved",
    assertions: [
      { kind: "review_cadence", intervalDays: 30, note: "Drift reconciliation window." },
      { kind: "monitoring_alert", destination: "datadog", maxLatencyMinutes: 60 },
    ],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884244" },
  },
  {
    id: "RA-5@1",
    kind: "requirement",
    requirementId: "RA-5",
    standardId: "STD-WSEC-1",
    code: "RA-5",
    version: 1,
    title: "Vulnerability scanning",
    text: "Production images and dependencies must be scanned weekly; high severity findings triaged.",
    effectiveDate: "2025-06-01",
    owner: DEVEX_LEAD,
    ownerTeam: "Developer Experience",
    applicability: ["ci_runner_identity", "service_principal"],
    environments: ["production", "non_production"],
    riskLevel: "moderate",
    verificationMethod: "automated_test",
    approvalStatus: "approved",
    assertions: [{ kind: "scan_cadence", intervalDays: 7, severityThreshold: "high" }],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884249" },
  },
  {
    id: "CP-9@1",
    kind: "requirement",
    requirementId: "CP-9",
    standardId: "STD-WSEC-1",
    code: "CP-9",
    version: 1,
    title: "Backup and restore validation",
    text: "Restore procedures for production data stores must be exercised at least quarterly.",
    effectiveDate: "2025-08-01",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    applicability: ["service_principal"],
    environments: ["production"],
    riskLevel: "moderate",
    verificationMethod: "manual_attestation",
    approvalStatus: "approved",
    assertions: [{ kind: "review_cadence", intervalDays: 90 }],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884253" },
  },
  {
    id: "IR-4@1",
    kind: "requirement",
    requirementId: "IR-4",
    standardId: "STD-WSEC-1",
    code: "IR-4",
    version: 1,
    title: "Incident response exercises",
    text: "Security incident response procedures must be exercised at least annually.",
    effectiveDate: "2025-01-20",
    owner: GOV_LEAD,
    ownerTeam: "Gov Cloud",
    applicability: ["human_privileged", "break_glass"],
    environments: ["production", "gov_cloud"],
    riskLevel: "low",
    verificationMethod: "manual_attestation",
    approvalStatus: "approved",
    assertions: [{ kind: "review_cadence", intervalDays: 365 }],
    sourceRef: { system: "confluence", ref: "WSEC/pages/884257" },
  },
];

// ---------------------------------------------------------------------------
// Controls. CTL-114 and CTL-118 carry the two latent gaps — expressed as data.
// ---------------------------------------------------------------------------

export const seedControls: Control[] = [
  {
    id: "CTL-114",
    kind: "control",
    code: "CTL-114",
    title: "Privileged access requires MFA",
    description:
      "Entra ID Conditional Access policy requiring a second factor for any role-activated " +
      "privileged session against production and Gov Cloud subscriptions. Policy is managed as " +
      "code in Terraform Cloud workspace wexler-identity-prod.",
    owner: IDENTITY_LEAD,
    ownerTeam: "Platform Identity",
    implementationStatus: "implemented",
    enforcedIn: [
      { system: "entra_id", ref: "CA-0031-priv-mfa" },
      { system: "terraform_cloud", ref: "wexler-identity-prod" },
    ],
    coversIdentityClasses: ["human_privileged", "contractor"],
    environments: ["production", "gov_cloud"],
    properties: [
      {
        kind: "auth_factor_policy",
        // The planted gap: TOTP and SMS are still acceptable factors, and the
        // policy allows falling back to them when no hardware key is enrolled.
        permittedFactors: ["totp", "sms", "push", "fido2", "smartcard_piv"],
        allowsFallback: true,
        appliesTo: ["human_privileged", "contractor"],
        environments: ["production", "gov_cloud"],
        note: "Grant control: require multifactor authentication (any enrolled method).",
      },
    ],
    lastReviewed: "2026-06-11",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B114" },
  },
  {
    id: "CTL-118",
    kind: "control",
    code: "CTL-118",
    title: "Entitlement access review",
    description:
      "Entra ID Access Reviews recertify production entitlement assignments. Reviewers are the " +
      "resource owners; sign-off is filed as a ServiceNow record.",
    owner: GRC_LEAD,
    ownerTeam: "GRC",
    implementationStatus: "implemented",
    enforcedIn: [
      { system: "entra_id", ref: "AR-prod-entitlements" },
      { system: "servicenow", ref: "REVIEW-CATALOG-12" },
    ],
    coversIdentityClasses: ["human_privileged", "human_standard", "contractor"],
    environments: ["production", "gov_cloud"],
    properties: [
      // The second planted gap: configured annually. Compliant with AC-5 today.
      { kind: "review_cadence", intervalDays: 365, note: "Annual recurrence in Entra Access Reviews." },
    ],
    lastReviewed: "2026-01-30",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B118" },
  },
  {
    id: "CTL-121",
    kind: "control",
    code: "CTL-121",
    title: "Workload credential rotation",
    description:
      "Service principal and managed identity credentials are issued with 90-day maximum " +
      "lifetime and rotated by the platform rotation job.",
    owner: IDENTITY_LEAD,
    ownerTeam: "Platform Identity",
    implementationStatus: "partially_implemented",
    enforcedIn: [
      { system: "entra_id", ref: "SP-lifecycle-policy" },
      { system: "aws", ref: "iam-rotation-lambda" },
    ],
    // Note the absence of ci_runner_identity: GitHub Actions runners still use
    // long-lived PATs. That is DEVEX-2210, and it is why SC-4 coverage is partial.
    coversIdentityClasses: ["service_principal", "managed_identity"],
    environments: ["production", "gov_cloud", "non_production"],
    properties: [{ kind: "credential_rotation", maxAgeDays: 90 }],
    lastReviewed: "2026-05-20",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B121" },
  },
  {
    id: "CTL-133",
    kind: "control",
    code: "CTL-133",
    title: "Immutable audit log retention",
    description: "Splunk index with 400-day frozen retention and WORM archive to S3 Object Lock.",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    implementationStatus: "implemented",
    enforcedIn: [
      { system: "splunk", ref: "idx_sec_audit" },
      { system: "aws", ref: "s3://wexler-audit-archive" },
    ],
    coversIdentityClasses: ["human_privileged", "service_principal", "break_glass"],
    environments: ["production", "gov_cloud"],
    properties: [{ kind: "log_retention", retentionDays: 400, immutable: true }],
    lastReviewed: "2026-07-02",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B133" },
  },
  {
    id: "CTL-140",
    kind: "control",
    code: "CTL-140",
    title: "Break-glass account governance",
    description:
      "Regional control-plane break-glass accounts are excluded from Conditional Access by " +
      "design, alerted on use, and reviewed after the fact.",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    implementationStatus: "implemented",
    enforcedIn: [
      { system: "aws", ref: "org-breakglass-ou" },
      { system: "azure", ref: "gov-breakglass-rg" },
      { system: "splunk", ref: "alert_breakglass_use" },
    ],
    coversIdentityClasses: ["break_glass"],
    environments: ["production", "gov_cloud"],
    properties: [
      { kind: "monitoring_alert", destination: "splunk", maxLatencyMinutes: 15 },
      { kind: "approval_workflow", approversRequired: 1, postIncidentReviewHours: 72 },
    ],
    lastReviewed: "2026-07-15",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B140" },
  },
  {
    id: "CTL-152",
    kind: "control",
    code: "CTL-152",
    title: "Contractor access provisioning",
    description:
      "Contractor and third-party identities in the acquired business unit are provisioned in " +
      "Okta with time-bound group membership and semi-annual recertification.",
    owner: GRC_LEAD,
    ownerTeam: "GRC",
    implementationStatus: "implemented",
    enforcedIn: [{ system: "okta", ref: "grp_contractor_prod" }],
    coversIdentityClasses: ["contractor", "third_party_integration"],
    environments: ["production", "corporate"],
    properties: [{ kind: "review_cadence", intervalDays: 180 }],
    lastReviewed: "2026-02-14",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B152" },
  },
  {
    id: "CTL-160",
    kind: "control",
    code: "CTL-160",
    title: "Infrastructure drift detection",
    description: "Terraform Cloud drift detection on production workspaces, alerting to Datadog.",
    owner: SRE_LEAD,
    ownerTeam: "Cloud SRE",
    implementationStatus: "implemented",
    enforcedIn: [
      { system: "terraform_cloud", ref: "drift-prod-all" },
      { system: "datadog", ref: "monitor-tf-drift" },
    ],
    coversIdentityClasses: ["service_principal", "managed_identity"],
    environments: ["production", "gov_cloud"],
    properties: [
      { kind: "review_cadence", intervalDays: 14 },
      { kind: "monitoring_alert", destination: "datadog", maxLatencyMinutes: 30 },
    ],
    lastReviewed: "2026-08-20",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B160" },
  },
  {
    id: "CTL-166",
    kind: "control",
    code: "CTL-166",
    title: "Container and dependency scanning",
    description: "Weekly scheduled scan of production images and lockfiles in GitHub Actions.",
    owner: DEVEX_LEAD,
    ownerTeam: "Developer Experience",
    implementationStatus: "implemented",
    enforcedIn: [{ system: "github_actions", ref: "wexler/platform/.github/workflows/scan.yml" }],
    coversIdentityClasses: ["ci_runner_identity", "service_principal"],
    environments: ["production", "non_production"],
    properties: [{ kind: "scan_cadence", intervalDays: 7, severityThreshold: "high" }],
    lastReviewed: "2026-08-04",
    sourceRef: { system: "google_sheets", ref: "SOC2-matrix!B166" },
  },
];

// ---------------------------------------------------------------------------
// Work items — two trackers, never consolidated after the 2019 acquisition.
// ---------------------------------------------------------------------------

export const seedWorkItems: WorkItem[] = [
  {
    id: "WI-DEVEX-2210",
    kind: "work_item",
    title: "Migrate GitHub Actions runners off long-lived PATs to OIDC",
    team: "Developer Experience",
    sprint: "DX-2026.17",
    status: "in_progress",
    assignee: DEVEX_LEAD,
    acceptanceCriteria: [
      "No workflow references a PAT stored in repository or org secrets",
      "Runner jobs assume role via OIDC federation to AWS and Azure",
      "Rotation job reports zero credentials older than 90 days for CI identities",
    ],
    sourceRef: { system: "jira", ref: "DEVEX-2210" },
  },
  {
    id: "WI-AB-12844",
    kind: "work_item",
    title: "Enforce Conditional Access on Azure DevOps release pipelines",
    team: "Gov Cloud",
    sprint: "GOV-26.8",
    status: "in_progress",
    assignee: GOV_LEAD,
    acceptanceCriteria: [
      "Release pipeline service connections require CA-0031 compliant sign-in",
      "Gov tenant pipelines blocked when factor policy is not satisfied",
    ],
    sourceRef: { system: "azure_boards", ref: "12844" },
  },
  {
    id: "WI-PLAT-4471",
    kind: "work_item",
    title: "Rotate service principal credentials in eu-west-1",
    team: "Platform Identity",
    sprint: "PI-2026.17",
    status: "in_progress",
    assignee: IDENTITY_LEAD,
    acceptanceCriteria: [
      "All eu-west-1 service principals re-issued with 90-day secrets",
      "Rotation evidence exported to the platform attestation bucket",
    ],
    sourceRef: { system: "jira", ref: "PLAT-4471" },
  },
  {
    id: "WI-AB-13002",
    kind: "work_item",
    title: "Onboard Gov tenant to Entra access review workflow",
    team: "Gov Cloud",
    status: "backlog",
    acceptanceCriteria: [
      "Gov tenant entitlements enrolled in the production access review campaign",
      "Reviewer assignment mirrors corp tenant resource ownership",
    ],
    sourceRef: { system: "azure_boards", ref: "13002" },
  },
  {
    id: "WI-PLAT-4502",
    kind: "work_item",
    title: "Retire SMS fallback for corporate administrator accounts",
    team: "Platform Identity",
    status: "backlog",
    acceptanceCriteria: ["SMS removed as an enrollable method for privileged roles"],
    sourceRef: { system: "jira", ref: "PLAT-4502" },
  },
  {
    id: "WI-SRE-3310",
    kind: "work_item",
    title: "Splunk retention tier migration for Gov region",
    team: "Cloud SRE",
    sprint: "SRE-26.15",
    status: "done",
    assignee: SRE_LEAD,
    acceptanceCriteria: ["idx_sec_audit frozen retention set to 400 days in the Gov region"],
    sourceRef: { system: "jira", ref: "SRE-3310" },
  },
  {
    id: "WI-GRC-880",
    kind: "work_item",
    title: "Contractor recertification campaign in Okta",
    team: "GRC",
    sprint: "GRC-26.8",
    status: "in_review",
    assignee: GRC_LEAD,
    acceptanceCriteria: ["Semi-annual campaign completed with signed reviewer attestations"],
    sourceRef: { system: "jira", ref: "GRC-880" },
  },
  {
    id: "WI-SRE-3355",
    kind: "work_item",
    title: "Route Terraform Cloud drift alerts to Datadog on-call",
    team: "Cloud SRE",
    status: "done",
    assignee: SRE_LEAD,
    acceptanceCriteria: ["Drift events page the platform on-call within 30 minutes"],
    sourceRef: { system: "jira", ref: "SRE-3355" },
  },
  {
    id: "WI-DEVEX-2244",
    kind: "work_item",
    title: "Weekly image scan stage in the release pipeline",
    team: "Developer Experience",
    status: "done",
    assignee: DEVEX_LEAD,
    acceptanceCriteria: ["Scheduled scan runs weekly and fails the build on high severity"],
    sourceRef: { system: "jira", ref: "DEVEX-2244" },
  },
  {
    id: "WI-AB-12990",
    kind: "work_item",
    title: "Document break-glass retrieval procedure for regional control planes",
    team: "Gov Cloud",
    sprint: "GOV-26.8",
    status: "in_progress",
    assignee: GOV_LEAD,
    acceptanceCriteria: ["Runbook published", "Splunk alert verified end to end"],
    sourceRef: { system: "azure_boards", ref: "12990" },
  },
  {
    id: "WI-PLAT-4488",
    kind: "work_item",
    title: "FIDO2 security key rollout to Platform Identity administrators",
    team: "Platform Identity",
    sprint: "PI-2026.17",
    status: "in_progress",
    assignee: IDENTITY_LEAD,
    acceptanceCriteria: ["All Platform Identity admins enrolled with a hardware authenticator"],
    sourceRef: { system: "jira", ref: "PLAT-4488" },
  },
  {
    // Deliberately unlinked: orphan work the graph should expose.
    id: "WI-SRE-3402",
    kind: "work_item",
    title: "Automate restore drills for Aurora production clusters",
    team: "Cloud SRE",
    status: "backlog",
    acceptanceCriteria: ["Quarterly restore drill runs unattended and files its own evidence"],
    sourceRef: { system: "jira", ref: "SRE-3402" },
  },
];

// ---------------------------------------------------------------------------
// Tests. `assertions` is what the test actually checks — not what we wish it
// checked. test-entra-ca-mfa-required proves MFA is required, and says nothing
// about which factors are acceptable. That is why it stops proving AC-2.
// ---------------------------------------------------------------------------

export const seedTests: TestDefinition[] = [
  {
    id: "test-entra-ca-mfa-required",
    kind: "test",
    title: "Conditional Access requires MFA for privileged roles",
    runner: "github_actions",
    lastRun: "2026-08-25",
    lastResult: "pass",
    verifies: "automated_test",
    assertions: [
      {
        kind: "auth_factor_policy",
        permittedFactors: ["totp", "sms", "push", "fido2", "smartcard_piv"],
        requirePhishingResistant: false,
        allowsFallback: true,
        appliesTo: ["human_privileged", "contractor"],
        environments: ["production", "gov_cloud"],
        note: "Asserts grantControls contains 'mfa'. Does not assert factor strength.",
      },
    ],
    sourceRef: { system: "github_actions", ref: "wexler/identity/.github/workflows/ca-policy.yml" },
  },
  {
    id: "test-sp-credential-age",
    kind: "test",
    title: "No service principal secret older than 90 days",
    runner: "github_actions",
    lastRun: "2026-08-26",
    lastResult: "pass",
    verifies: "configuration_export",
    assertions: [
      {
        kind: "credential_rotation",
        maxAgeDays: 90,
        appliesTo: ["service_principal", "managed_identity"],
      },
    ],
    sourceRef: { system: "github_actions", ref: "wexler/identity/.github/workflows/sp-age.yml" },
  },
  {
    id: "test-splunk-retention",
    kind: "test",
    title: "Audit index retains 400 days immutably",
    runner: "vanta",
    lastRun: "2026-08-27",
    lastResult: "pass",
    verifies: "continuous_monitoring",
    assertions: [{ kind: "log_retention", retentionDays: 400, immutable: true }],
    sourceRef: { system: "vanta", ref: "monitor-splunk-retention" },
  },
  {
    id: "test-tf-drift-window",
    kind: "test",
    title: "Terraform drift reconciled within 14 days",
    runner: "azure_pipelines",
    lastRun: "2026-08-20",
    lastResult: "pass",
    verifies: "continuous_monitoring",
    assertions: [{ kind: "review_cadence", intervalDays: 14 }],
    sourceRef: { system: "azure_pipelines", ref: "wexler-gov/drift-check" },
  },
  {
    id: "test-image-scan-weekly",
    kind: "test",
    title: "Production images scanned within the last 7 days",
    runner: "github_actions",
    lastRun: "2026-08-24",
    lastResult: "pass",
    verifies: "automated_test",
    assertions: [{ kind: "scan_cadence", intervalDays: 7, severityThreshold: "high" }],
    sourceRef: { system: "github_actions", ref: "wexler/platform/.github/workflows/scan.yml" },
  },
  {
    id: "test-okta-contractor-expiry",
    kind: "test",
    title: "Contractor group membership carries an expiry date",
    runner: "azure_pipelines",
    lastRun: "2026-08-18",
    lastResult: "pass",
    verifies: "manual_attestation",
    assertions: [{ kind: "review_cadence", intervalDays: 180, appliesTo: ["contractor"] }],
    sourceRef: { system: "azure_pipelines", ref: "wexler-bu/okta-hygiene" },
  },
];

// ---------------------------------------------------------------------------
// Evidence. Two items are past their freshness window on DEMO_TODAY — a
// well-run org still has drift, and 100% clean reads as fake.
// ---------------------------------------------------------------------------

export const seedEvidence: Evidence[] = [
  {
    id: "EV-01",
    kind: "evidence",
    title: "Entra Conditional Access policy export (CA-0031)",
    evidenceType: "configuration_export",
    collectedAt: "2026-08-02",
    lastVerified: "2026-08-02",
    freshnessWindowDays: 90,
    collectedBy: IDENTITY_LEAD,
    sourceRef: { system: "entra_id", ref: "export/CA-0031/2026-08-02.json" },
  },
  {
    id: "EV-02",
    kind: "evidence",
    title: "GitHub Actions attestation — ca-policy workflow run 4471",
    evidenceType: "attestation",
    collectedAt: "2026-08-25",
    lastVerified: "2026-08-25",
    freshnessWindowDays: 30,
    collectedBy: "ci@wexler.example",
    sourceRef: { system: "github_actions", ref: "wexler/identity/runs/4471" },
  },
  {
    id: "EV-03",
    kind: "evidence",
    title: "ServiceNow access review sign-off — production entitlements FY26",
    evidenceType: "signoff",
    collectedAt: "2025-07-30",
    lastVerified: "2025-07-30",
    freshnessWindowDays: 365,
    collectedBy: GRC_LEAD,
    sourceRef: { system: "servicenow", ref: "RITM0079221" },
  },
  {
    id: "EV-04",
    kind: "evidence",
    title: "Terraform plan output — wexler-identity-prod",
    evidenceType: "plan_output",
    collectedAt: "2026-06-11",
    lastVerified: "2026-06-11",
    freshnessWindowDays: 90,
    collectedBy: IDENTITY_LEAD,
    sourceRef: { system: "terraform_cloud", ref: "run-8Kq2mT" },
  },
  {
    id: "EV-05",
    kind: "evidence",
    title: "Vanta monitor result — Splunk retention",
    evidenceType: "monitor_result",
    collectedAt: "2026-08-27",
    lastVerified: "2026-08-27",
    freshnessWindowDays: 30,
    collectedBy: "vanta@wexler.example",
    sourceRef: { system: "vanta", ref: "monitor-splunk-retention/2026-08-27" },
  },
  {
    id: "EV-06",
    kind: "evidence",
    title: "Okta contractor group membership export",
    evidenceType: "configuration_export",
    collectedAt: "2026-02-14",
    lastVerified: "2026-02-14",
    freshnessWindowDays: 180,
    collectedBy: GRC_LEAD,
    sourceRef: { system: "okta", ref: "reports/grp_contractor_prod/2026-02-14" },
  },
  {
    id: "EV-07",
    kind: "evidence",
    title: "Datadog drift monitor history",
    evidenceType: "monitor_result",
    collectedAt: "2026-08-20",
    lastVerified: "2026-08-20",
    freshnessWindowDays: 30,
    collectedBy: SRE_LEAD,
    sourceRef: { system: "datadog", ref: "monitor-tf-drift/history" },
  },
  {
    id: "EV-08",
    kind: "evidence",
    title: "GitHub Actions attestation — weekly image scan",
    evidenceType: "attestation",
    collectedAt: "2026-08-24",
    lastVerified: "2026-08-24",
    freshnessWindowDays: 14,
    collectedBy: "ci@wexler.example",
    sourceRef: { system: "github_actions", ref: "wexler/platform/runs/91204" },
  },
  {
    id: "EV-09",
    kind: "evidence",
    title: "Break-glass quarterly attestation",
    evidenceType: "signoff",
    collectedAt: "2026-07-15",
    lastVerified: "2026-07-15",
    freshnessWindowDays: 90,
    collectedBy: SRE_LEAD,
    sourceRef: { system: "servicenow", ref: "RITM0083907" },
  },
];

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export const seedExceptions: Exception[] = [
  {
    id: "EXC-07",
    kind: "exception",
    code: "EXC-07",
    title: "Contractor SRE authentication in the Bangalore support org",
    approver: GRC_LEAD,
    approvedAt: "2026-04-15",
    expiresAt: "2026-10-10",
    reason:
      "Hardware authenticators cannot be shipped to the contracting partner's Bangalore facility " +
      "under the current import arrangement. TOTP accepted as an interim factor.",
    appliesTo: ["contractor"],
    environments: ["production"],
    grounds: [
      {
        kind: "auth_factor_policy",
        permittedFactors: ["totp"],
        appliesTo: ["contractor"],
        environments: ["production"],
        note: "Relief granted: TOTP in place of a hardware authenticator.",
      },
    ],
    exemptsControlIds: ["CTL-114"],
    status: "active",
    sourceRef: { system: "servicenow", ref: "RITM0084412" },
  },
  {
    id: "EXC-11",
    kind: "exception",
    code: "EXC-11",
    title: "Break-glass accounts exempt from Conditional Access",
    approver: SRE_LEAD,
    approvedAt: "2026-02-20",
    expiresAt: "2027-03-31",
    reason:
      "Regional control-plane break-glass credentials must remain usable when the identity " +
      "provider is unavailable, which is the condition they exist for.",
    appliesTo: ["break_glass"],
    environments: ["production", "gov_cloud"],
    grounds: [
      {
        kind: "auth_factor_policy",
        permittedFactors: ["password"],
        appliesTo: ["break_glass"],
        environments: ["production", "gov_cloud"],
        note: "Relief granted: credential retrieval without IdP-backed factors.",
      },
    ],
    exemptsControlIds: ["CTL-114"],
    status: "active",
    sourceRef: { system: "servicenow", ref: "RITM0081155" },
  },
];

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export const seedDecisions: Decision[] = [
  {
    id: "DEC-21",
    kind: "decision",
    title: "Retain Okta for the acquired business unit through FY27",
    decidedBy: GRC_LEAD,
    decidedAt: "2025-11-12",
    rationale:
      "Migration of the acquired BU to Entra ID is sequenced after the Gov Cloud authorization. " +
      "Until then contractor identity remains in Okta and is governed by CTL-152.",
    approvalHistory: [
      { actor: IDENTITY_LEAD, action: "proposed", at: "2025-10-30" },
      { actor: GRC_LEAD, action: "approved", at: "2025-11-12", note: "Accepted with FY27 review date." },
    ],
    relatedEntityIds: ["CTL-152", "SR-2"],
    sourceRef: { system: "sharepoint", ref: "ADR/2025-11-okta-retention" },
  },
  {
    id: "DEC-24",
    kind: "decision",
    title: "Break-glass credentials remain outside the identity provider",
    decidedBy: SRE_LEAD,
    decidedAt: "2026-02-18",
    rationale:
      "A break-glass path that depends on the IdP fails in exactly the scenario it exists for. " +
      "Compensating governance is preferred over factor strength for these accounts.",
    approvalHistory: [
      { actor: SRE_LEAD, action: "proposed", at: "2026-02-05" },
      { actor: GOV_LEAD, action: "approved", at: "2026-02-18" },
    ],
    relatedEntityIds: ["CTL-140", "EXC-11", "AC-9"],
    sourceRef: { system: "sharepoint", ref: "ADR/2026-02-breakglass" },
  },
];

// ---------------------------------------------------------------------------
// Edges. Every edge carries provenance; edges address requirements by their
// stable `requirementId`, not by version, so they survive re-versioning.
// ---------------------------------------------------------------------------

export const seedEdges: TraceEdge[] = [
  // implements: control -> requirement
  {
    id: "E-001",
    type: "implements",
    from: "CTL-114",
    to: "AC-2",
    provenance: human(
      IDENTITY_LEAD,
      "2026-01-20",
      "CA-0031 is the enforcement point for privileged MFA named in AC-2.",
      { system: "google_sheets", ref: "SOC2-matrix!B114" },
      "2026-06-11",
    ),
  },
  {
    id: "E-002",
    type: "implements",
    from: "CTL-118",
    to: "AC-5",
    provenance: human(GRC_LEAD, "2025-07-05", "Entra Access Reviews perform the AC-5 recertification.", { system: "google_sheets", ref: "SOC2-matrix!B118" }, "2026-01-30"),
  },
  {
    id: "E-003",
    type: "implements",
    from: "CTL-121",
    to: "SC-4",
    provenance: human(IDENTITY_LEAD, "2025-09-08", "Rotation policy enforces the SC-4 90-day maximum credential age.", undefined, "2026-05-20"),
  },
  {
    id: "E-004",
    type: "implements",
    from: "CTL-133",
    to: "AU-3",
    provenance: human(SRE_LEAD, "2024-11-14", "Splunk index retention satisfies AU-3 retention and immutability.", undefined, "2026-07-02"),
  },
  {
    id: "E-005",
    type: "implements",
    from: "CTL-140",
    to: "AC-9",
    provenance: human(SRE_LEAD, "2025-02-15", "Break-glass governance is the AC-9 implementation.", { system: "sharepoint", ref: "ADR/2026-02-breakglass" }, "2026-07-15"),
  },
  {
    id: "E-006",
    type: "implements",
    from: "CTL-152",
    to: "SR-2",
    provenance: human(GRC_LEAD, "2025-05-20", "Okta group lifecycle implements SR-2 for the acquired BU.", undefined, "2026-02-14"),
  },
  {
    id: "E-007",
    type: "implements",
    from: "CTL-160",
    to: "CM-6",
    provenance: human(SRE_LEAD, "2025-03-06", "Terraform Cloud drift detection is the CM-6 reconciliation mechanism.", undefined, "2026-08-20"),
  },
  {
    id: "E-008",
    type: "implements",
    from: "CTL-166",
    to: "RA-5",
    provenance: human(DEVEX_LEAD, "2025-06-10", "Weekly scan workflow implements the RA-5 cadence.", undefined, "2026-08-04"),
  },

  // verifies: test -> control
  {
    id: "E-101",
    type: "verifies",
    from: "test-entra-ca-mfa-required",
    to: "CTL-114",
    provenance: human(DEVEX_LEAD, "2026-01-22", "Workflow asserts the Conditional Access grant control is present.", { system: "github_actions", ref: "wexler/identity/runs/4471" }, "2026-08-25"),
  },
  {
    id: "E-102",
    type: "verifies",
    from: "test-sp-credential-age",
    to: "CTL-121",
    provenance: human(IDENTITY_LEAD, "2025-09-10", "Age check proves the rotation policy is effective, not just configured.", undefined, "2026-08-26"),
  },
  {
    id: "E-103",
    type: "verifies",
    from: "test-splunk-retention",
    to: "CTL-133",
    provenance: human(SRE_LEAD, "2025-01-08", "Vanta monitor continuously checks index retention settings.", undefined, "2026-08-27"),
  },
  {
    id: "E-104",
    type: "verifies",
    from: "test-tf-drift-window",
    to: "CTL-160",
    provenance: human(SRE_LEAD, "2025-03-10", "Pipeline check fails when drift is older than the reconciliation window.", undefined, "2026-08-20"),
  },
  {
    id: "E-105",
    type: "verifies",
    from: "test-image-scan-weekly",
    to: "CTL-166",
    provenance: human(DEVEX_LEAD, "2025-06-12", "Scan freshness check proves the weekly cadence held.", undefined, "2026-08-24"),
  },
  {
    // Proposed and unverified in the initial state: the acquired BU's pipeline
    // was wired up by an automation and nobody has confirmed it maps to CTL-152.
    id: "E-106",
    type: "verifies",
    from: "test-okta-contractor-expiry",
    to: "CTL-152",
    provenance: {
      createdBy: "agent:webmcp",
      origin: "agent",
      createdAt: "2026-08-18",
      rationale: "Pipeline checks contractor group expiry, which is the mechanism CTL-152 relies on.",
      supportedBy: { system: "azure_pipelines", ref: "wexler-bu/okta-hygiene" },
      state: "proposed",
    },
  },

  // fulfills: work_item -> control
  { id: "E-201", type: "fulfills", from: "WI-DEVEX-2210", to: "CTL-121", provenance: human(DEVEX_LEAD, "2026-05-04", "OIDC federation brings CI runner identities under the rotation control.") },
  { id: "E-202", type: "fulfills", from: "WI-AB-12844", to: "CTL-114", provenance: human(GOV_LEAD, "2026-06-02", "Extends CA enforcement to Gov release pipelines.") },
  { id: "E-203", type: "fulfills", from: "WI-PLAT-4471", to: "CTL-121", provenance: human(IDENTITY_LEAD, "2026-07-19", "Brings eu-west-1 principals into the rotation window.", { system: "jira", ref: "PLAT-4471" }, "2026-08-01") },
  { id: "E-204", type: "fulfills", from: "WI-AB-13002", to: "CTL-118", provenance: human(GOV_LEAD, "2026-06-02", "Gov tenant is not yet inside the access review campaign.") },
  { id: "E-205", type: "fulfills", from: "WI-PLAT-4502", to: "CTL-114", provenance: human(IDENTITY_LEAD, "2026-07-01", "Removes the weakest enrollable factor from privileged roles.") },
  { id: "E-206", type: "fulfills", from: "WI-SRE-3310", to: "CTL-133", provenance: human(SRE_LEAD, "2026-04-11", "Retention tier change is what makes CTL-133 true in the Gov region.", undefined, "2026-07-02") },
  { id: "E-207", type: "fulfills", from: "WI-GRC-880", to: "CTL-152", provenance: human(GRC_LEAD, "2026-06-20", "Recertification campaign is the recurring execution of CTL-152.") },
  { id: "E-208", type: "fulfills", from: "WI-SRE-3355", to: "CTL-160", provenance: human(SRE_LEAD, "2026-03-15", "Alert routing completes the drift detection loop.", undefined, "2026-08-20") },
  { id: "E-209", type: "fulfills", from: "WI-DEVEX-2244", to: "CTL-166", provenance: human(DEVEX_LEAD, "2026-02-09", "Adds the scan stage the control depends on.", undefined, "2026-08-04") },
  { id: "E-210", type: "fulfills", from: "WI-AB-12990", to: "CTL-140", provenance: human(GOV_LEAD, "2026-07-08", "Runbook is the documented retrieval procedure CTL-140 requires.") },
  { id: "E-211", type: "fulfills", from: "WI-PLAT-4488", to: "CTL-114", provenance: human(IDENTITY_LEAD, "2026-06-25", "Hardware key enrollment raises the factor strength available to CTL-114.") },

  // depends_on: work_item -> work_item
  { id: "E-231", type: "depends_on", from: "WI-AB-12844", to: "WI-PLAT-4488", provenance: human(GOV_LEAD, "2026-06-30", "Gov pipeline enforcement cannot land before admins hold hardware keys.") },
  { id: "E-232", type: "depends_on", from: "WI-AB-13002", to: "WI-GRC-880", provenance: human(GOV_LEAD, "2026-07-02", "Reviewer model is inherited from the corp campaign.") },

  // evidences: evidence -> control | test
  { id: "E-301", type: "evidences", from: "EV-01", to: "CTL-114", provenance: human(IDENTITY_LEAD, "2026-08-02", "Policy export shows the grant controls actually configured.", undefined, "2026-08-02") },
  { id: "E-302", type: "evidences", from: "EV-02", to: "test-entra-ca-mfa-required", provenance: human("ci@wexler.example", "2026-08-25", "Signed attestation for the workflow run.", undefined, "2026-08-25") },
  { id: "E-303", type: "evidences", from: "EV-03", to: "CTL-118", provenance: human(GRC_LEAD, "2025-07-30", "Reviewer sign-off for the FY26 recertification cycle.", undefined, "2025-07-30") },
  { id: "E-304", type: "evidences", from: "EV-04", to: "CTL-114", provenance: human(IDENTITY_LEAD, "2026-06-11", "Terraform plan proves the policy is managed as code and unchanged.", undefined, "2026-06-11") },
  { id: "E-305", type: "evidences", from: "EV-05", to: "CTL-133", provenance: human("vanta@wexler.example", "2026-08-27", "Continuous monitor result for retention configuration.", undefined, "2026-08-27") },
  { id: "E-306", type: "evidences", from: "EV-06", to: "CTL-152", provenance: human(GRC_LEAD, "2026-02-14", "Membership export supporting the last recertification.", undefined, "2026-02-14") },
  { id: "E-307", type: "evidences", from: "EV-07", to: "CTL-160", provenance: human(SRE_LEAD, "2026-08-20", "Monitor history shows drift events and their resolution times.", undefined, "2026-08-20") },
  { id: "E-308", type: "evidences", from: "EV-08", to: "CTL-166", provenance: human("ci@wexler.example", "2026-08-24", "Attestation for the most recent scheduled scan.", undefined, "2026-08-24") },
  { id: "E-309", type: "evidences", from: "EV-09", to: "CTL-140", provenance: human(SRE_LEAD, "2026-07-15", "Quarterly attestation that break-glass credentials remain sealed.", undefined, "2026-07-15") },

  // excepts: exception -> control
  { id: "E-401", type: "excepts", from: "EXC-07", to: "CTL-114", provenance: human(GRC_LEAD, "2026-04-15", "Approved interim relief for the Bangalore contracting partner.", { system: "servicenow", ref: "RITM0084412" }, "2026-04-15") },
  { id: "E-402", type: "excepts", from: "EXC-11", to: "CTL-114", provenance: human(SRE_LEAD, "2026-02-20", "Break-glass accounts are excluded from Conditional Access by design.", { system: "servicenow", ref: "RITM0081155" }, "2026-02-20") },

  // documents: decision -> anything
  { id: "E-501", type: "documents", from: "DEC-21", to: "CTL-152", provenance: human(GRC_LEAD, "2025-11-12", "Architecture decision explaining why contractor identity is still in Okta.") },
  { id: "E-502", type: "documents", from: "DEC-24", to: "CTL-140", provenance: human(SRE_LEAD, "2026-02-18", "Architecture decision behind the break-glass posture.") },
];

// ---------------------------------------------------------------------------
// Assembled snapshot
// ---------------------------------------------------------------------------

export function seedSnapshot(): GraphSnapshot {
  return {
    entities: [
      seedStandard,
      ...seedRequirements,
      ...seedControls,
      ...seedWorkItems,
      ...seedTests,
      ...seedEvidence,
      ...seedExceptions,
      ...seedDecisions,
    ],
    edges: seedEdges,
  };
}
