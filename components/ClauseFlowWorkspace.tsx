'use client';

import { useEffect, useMemo, useState } from 'react';
import { proposedRequirement } from '@/lib/ripple/scenario';
import { syncToolsToView } from '@/lib/webmcp';
import { toolsForView } from '@/lib/ripple/tools';
import { HUMAN_ONLY_OPERATIONS } from '@/lib/ripple/actor';
import {
  applyReviewerConstraint,
  approveException,
  approveProposal,
  baselineRequirement,
  createReview,
  useProjectedReadiness,
  useReadiness,
  rejectProposal,
  resetScenario,
  runAnalysis,
  selectEntity,
  setView,
  useRipple,
} from '@/lib/ripple/store';
import { TraceGraph } from './TraceGraph';
import { describeAssertion } from '@/lib/ripple/impact';
import type { Entity, Exception, Finding, Proposal, SourceSystem, TraceEdge, WorkItem } from '@/lib/ripple/types';

type View = 'overview' | 'change' | 'impact' | 'graph' | 'execution' | 'evidence';
type Decision = 'pending' | 'approved' | 'rejected';
type ToolEvent = { name:string; phase:'started'|'completed'|'failed'; at:string; detail?:unknown };

const nav: { id: View; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'Incoming change and connected records' },
  { id: 'change', label: 'Change', hint: 'What AC-2 v3 actually alters' },
  { id: 'impact', label: 'Impact review', hint: 'Findings and the decisions they need' },
  { id: 'graph', label: 'Dependencies', hint: 'What breaks if this changes' },
  { id: 'execution', label: 'Work', hint: 'Jira and Azure Boards, joined to obligations' },
  { id: 'evidence', label: 'Evidence', hint: 'Matrix and audit packet' },
];

const sourceLabels: Record<SourceSystem, string> = {
  confluence:'Confluence', google_sheets:'Google Sheets', jira:'Jira', azure_boards:'Azure Boards', sharepoint:'SharePoint', github_actions:'GitHub Actions', azure_pipelines:'Azure Pipelines', entra_id:'Microsoft Entra ID', okta:'Okta', aws:'AWS', azure:'Azure', terraform_cloud:'Terraform Cloud', splunk:'Splunk', datadog:'Datadog', servicenow:'ServiceNow', vanta:'Vanta', throughline:'RippleTrace',
};


type ConnectedRecord = { id:string; system:SourceSystem; kind:string; title:string; ref:string; status:string; owner:string };
const connectedRecords:ConnectedRecord[] = [
  {id:'policy',system:'confluence',kind:'Policy page',title:'Wexler Security Standard · Privileged access',ref:'WSEC / pages / 884215',status:'Approved · v4.2',owner:'Security Governance'},
  {id:'matrix',system:'google_sheets',kind:'Control matrix',title:'SOC 2 / ISO 27001 control mapping',ref:'SOC2-matrix!B114',status:'1 control affected',owner:'GRC'},
  {id:'jira',system:'jira',kind:'Work item',title:'FIDO2 security key rollout',ref:'PLAT-4488',status:'In progress',owner:'Platform Identity'},
  {id:'boards',system:'azure_boards',kind:'Work item',title:'Enforce Conditional Access on release pipelines',ref:'12844',status:'In progress',owner:'Developer Experience'},
  {id:'decision',system:'sharepoint',kind:'Architecture decision',title:'Break-glass credentials remain outside the IdP',ref:'ADR / 2026-02-breakglass',status:'Accepted',owner:'Cloud SRE'},
  {id:'gha',system:'github_actions',kind:'Automated test',title:'Conditional Access requires MFA',ref:'identity / actions / runs / 4471',status:'Passing · now insufficient',owner:'Platform Identity'},
  {id:'pipeline',system:'azure_pipelines',kind:'Pipeline test',title:'Service-principal credential age',ref:'wexler-gov / drift-check / 913',status:'Passing',owner:'Gov Cloud'},
  {id:'entra',system:'entra_id',kind:'Identity policy',title:'CA-0031 · Privileged MFA policy',ref:'Conditional Access / CA-0031',status:'Enabled · weak fallback',owner:'Identity Platform'},
  {id:'okta',system:'okta',kind:'Identity evidence',title:'Contractor group membership export',ref:'grp_contractor_prod',status:'196 days old',owner:'Acquired Business Unit'},
  {id:'terraform',system:'terraform_cloud',kind:'Infrastructure run',title:'wexler-identity-prod',ref:'run-8Kq2mT',status:'Applied',owner:'Cloud Platform'},
  {id:'exception',system:'servicenow',kind:'Exception approval',title:'Contractor SRE authentication exception',ref:'RITM0084412',status:'Requires reapproval',owner:'Risk Acceptance'},
  {id:'monitor',system:'vanta',kind:'Continuous monitor',title:'MFA enforcement across privileged accounts',ref:'Monitor / identity-mfa-04',status:'Needs attention',owner:'Security Assurance'},
];

export default function ClauseFlowWorkspace() {
  const view = useRipple((s) => s.view);
  const entities = useRipple((s) => s.entities);
  const edges = useRipple((s) => s.edges);
  const findings = useRipple((s) => s.findings);
  const analyzed = useRipple((s) => s.analyzed);
  const storeProposals = useRipple((s) => s.proposals);
  const reviewId = useRipple((s) => s.reviewId);
  const constraintApplied = useRipple((s) => s.reviewerConstraint);
  const auditTrail = useRipple((s) => s.activity);
  const selectedRecordId = useRipple((s) => s.selectedEntityId);

  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [toast, setToast] = useState('');

  // Readiness is recomputed from the live graph on every change. Approving a
  // fix mutates the graph, so the score moves because the world moved — there
  // is no bonus for activity anywhere in this component.
  const score = useReadiness();
  const projected = useProjectedReadiness();
  const before = useRipple(() => baselineRequirement());
  // The registered set is a pure function of the view, so it is derived rather
  // than mirrored into state by the effect that performs the registration.
  const registered = useMemo(() => toolsForView(view).map((t) => t.name), [view]);

  const exceptions = useMemo(
    () => entities.filter((e): e is Exception => e.kind === 'exception'),
    [entities],
  );
  const decisions = useMemo(
    () =>
      storeProposals.reduce<Record<string, Decision>>((acc, proposal) => {
        acc[proposal.id] = proposal.status === 'edited' ? 'approved' : (proposal.status as Decision);
        return acc;
      }, {}),
    [storeProposals],
  );
  const decided = storeProposals.filter((p) => p.status !== 'pending').length;
  const approved = storeProposals.filter((p) => p.status === 'approved' || p.status === 'edited').length;
  const linkedRecordCount = useMemo(
    () => new Set(findings.flatMap((f) => [...f.entityIds, ...f.derivation.comparedEntityIds])).size,
    [findings],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const analyze = () => {
    const produced = runAnalysis();
    setView('impact');
    notify(`${produced.length} grounded findings.`);
    return produced;
  };
  const draftReview = () => {
    const { reviewId: id } = createReview();
    notify(`${id} drafted. Nothing is approved.`);
  };
  const decide = (id: string, decision: Decision) => {
    const result = decision === 'approved' ? approveProposal(id) : rejectProposal(id);
    notify(`${id} ${decision} by Dana Lindqvist.`);
    return result;
  };
  const reapprove = (id: string) => {
    approveException(id, 'Risk reaccepted against the revised requirement.');
    notify(`${id} reapproved by Dana Lindqvist.`);
  };
  const pushBack = () => {
    const added = applyReviewerConstraint();
    notify(`${added.length} compensating proposals drafted from your constraint.`);
  };
  const reset = () => {
    resetScenario();
    setToolEvents([]);
    notify('Wexler scenario reset.');
  };

  // Dynamic registration: the agent's surface follows the human's attention.
  // Entering a view registers its set and aborts the controller for the last one.
  useEffect(() => {
    syncToolsToView(view);
  }, [view]);

  useEffect(() => {
    const receive = (event: Event) => {
      const item = (event as CustomEvent<ToolEvent>).detail;
      setToolEvents((events) => [item, ...events].slice(0, 30));
    };
    window.addEventListener('ripple:webmcp-activity', receive);
    return () => window.removeEventListener('ripple:webmcp-activity', receive);
  }, []);

  return <main className="rt-app">
    <header className="rt-topbar"><div className="rt-brand"><div className="rt-mark">R</div><div><strong>RippleTrace</strong><span>Policy-to-execution intelligence</span></div></div><div className="rt-company"><button className="reset-scenario" onClick={reset}>↻ Reset Wexler scenario</button><span className="environment" title="Systems of record are represented in seed data, not live integrations.">Synthetic data · no live integrations</span><div><strong>Wexler Systems</strong><span>Security Assurance</span></div><div className="rt-avatar">DL</div></div></header>
    <div className={`rt-layout${view==='graph'?' full-bleed':''}`}>
      <aside className="rt-sidebar"><div className="standard-card"><span>Active standard</span><strong>WSEC-1 · v4.2</strong><p>SOC 2 · ISO 27001 · FedRAMP Moderate</p></div><nav>{nav.map((n)=><button key={n.id} title={n.hint} className={view===n.id?'active':''} onClick={()=>setView(n.id)}>{n.label}{n.id==='impact'&&analyzed&&<b>{findings.length}</b>}</button>)}</nav><div className="sidebar-footer"><div><span>Last synchronization</span><strong>Today · 14:32 IST</strong></div></div></aside>
      <section className="rt-main">
        {view==='overview'&&<><Overview onStart={()=>setView('change')} baseline={score.score} linked={linkedRecordCount||13} /><ConnectedSystemsExplorer /></>}
        {view==='change'&&<ChangeView before={before.text} onAnalyze={analyze} />}
        {view==='impact'&&<ImpactView analyzed={analyzed} findings={findings} proposals={storeProposals} decisions={decisions} reviewId={reviewId} constraintApplied={constraintApplied} onAnalyze={analyze} onDraft={draftReview} onDecide={decide} onPushBack={pushBack} exceptions={exceptions} onReapprove={reapprove} onInspect={selectEntity} />}
        {view==='graph'&&<TraceGraph />}
        {view==='execution'&&<ExecutionView entities={entities} findings={findings} proposals={storeProposals} analyzed={analyzed} approved={approved} decisions={decisions} />}
        {view==='evidence'&&<EvidenceView entities={entities} findings={findings} analyzed={analyzed} onInspect={selectEntity} />}
      </section>
      {view!=='graph'&&<aside className="rt-rail"><Readiness score={score.score} baseline={score.score} after={projected.score} analyzed={analyzed} components={score.components}/><AuthorityPanel view={view} registered={registered}/><AgentTimeline events={toolEvents}/><ReviewQueue decided={decided} total={storeProposals.length}/><div className="activity"><div className="section-label">Decision audit</div>{auditTrail.slice(0,5).map((entry)=><p key={entry.id}><i />{entry.message}</p>)}</div></aside>}
    </div>{selectedRecordId&&<EvidenceDrawer id={selectedRecordId} entities={entities} findings={findings} edges={edges} onClose={()=>selectEntity(null)}/>} {toast&&<div className="rt-toast" role="status">{toast}</div>}
  </main>;
}

function AuthorityPanel({view,registered}:{view:string;registered:string[]}){
  return <div className="rail-card authority">
    <div className="section-label">Agent authority · {view}</div>
    <div className="authority-group">
      <h4>Registered for this view ({registered.length})</h4>
      <div className="authority-tools">{registered.map((name)=><span key={name}>{name}</span>)}</div>
    </div>
    <div className="authority-group">
      <h4>Never registered</h4>
      <div className="authority-tools denied">{HUMAN_ONLY_OPERATIONS.map((op)=><span key={op.name} title={op.where}>{op.name}</span>)}</div>
      <p className="authority-note">These have no tool definition anywhere in the codebase, and the store rejects approved-state writes that originate from a tool handler. The agent proposes; a person decides.</p>
    </div>
  </div>;
}

function PageTitle({kicker,title,description,action}:{kicker:string;title:string;description:string;action?:React.ReactNode}){return <div className="page-title"><div><span>{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>}

function Overview({onStart,baseline,linked}:{onStart:()=>void;baseline:number;linked:number}){return <><section className="change-event"><div className="event-source"><span className="system-glyph confluence">C</span><div><small>Incoming enterprise event · Confluence</small><strong>AC2-CHG-2026-017</strong></div><b>Unassessed</b></div><div className="event-copy"><span>Proposed by Patricia Okafor · Security Governance · 9 minutes ago</span><h1>Privileged access policy changed. What breaks if Wexler approves it?</h1><p>AC-2 v3 removes weak-factor fallback, requires phishing-resistant authentication and expands scope to workload identities. RippleTrace has identified {linked} linked records across eight systems, but has not evaluated or changed them.</p></div><div className="event-delta"><div><span>Current posture</span><strong>{baseline}</strong><small>/100</small></div><div className="delta-arrow">→</div><div><span>Proposed posture</span><strong>?</strong><small>agent assessment required</small></div></div><button className="rt-primary event-cta" onClick={onStart}>Investigate this change →</button></section><section className="surface event-context"><div><span className="section-label">Known blast radius</span><h2>The same obligation lives in different operational languages.</h2></div><div className="event-system-row">{['Confluence','Sheets','Jira','Azure Boards','GitHub','Entra ID','ServiceNow','Vanta'].map((label)=><span key={label}>{label}</span>)}</div></section></>}

function ConnectedSystemsExplorer(){const [selected,setSelected]=useState(connectedRecords[0]);const systems=[...new Set(connectedRecords.map((r)=>r.system))];return <section className="systems-explorer"><div className="systems-toolbar"><div><span className="section-label">Connected records</span><h2>Source activity</h2></div><div className="sync-status"><i/>Last synchronized · 4 minutes ago</div></div><div className="systems-body"><aside className="systems-nav"><button className="active"><span className="system-glyph all">∞</span><div><strong>All connected work</strong><small>{connectedRecords.length} records</small></div></button>{systems.map((s)=><button key={s} onClick={()=>setSelected(connectedRecords.find((r)=>r.system===s)!)} className={selected.system===s?'selected':''}><span className={`system-glyph ${s}`}>{systemInitial(s)}</span><div><strong>{sourceLabels[s]}</strong><small>{connectedRecords.filter((r)=>r.system===s).length} record</small></div></button>)}</aside><div className="record-list"><div className="record-list-head"><strong>Recently updated</strong><span>Source · Type · Status</span></div>{connectedRecords.map((record)=><button key={record.id} className={selected.id===record.id?'selected':''} onClick={()=>setSelected(record)}><span className={`system-glyph ${record.system}`}>{systemInitial(record.system)}</span><div><small>{sourceLabels[record.system]} · {record.kind}</small><strong>{record.title}</strong><em>{record.ref}</em></div><b>{record.status}</b></button>)}</div><SourcePreview record={selected}/></div></section>}
function systemInitial(system:SourceSystem){const initials:Partial<Record<SourceSystem,string>>={confluence:'C',google_sheets:'S',jira:'J',azure_boards:'A',sharepoint:'SP',github_actions:'GH',azure_pipelines:'AZ',entra_id:'E',okta:'O',terraform_cloud:'T',servicenow:'SN',vanta:'V'};return initials[system]||sourceLabels[system].slice(0,2).toUpperCase()}

function SourcePreview({record}:{record:ConnectedRecord}){return <aside className={`source-preview preview-${record.system}`}><div className="native-bar"><span className={`system-glyph ${record.system}`}>{systemInitial(record.system)}</span><div><strong>{sourceLabels[record.system]}</strong><small>{record.owner}</small></div><button>Open source ↗</button></div><div className="native-content">{record.system==='confluence'&&<ConfluencePreview/>}{record.system==='google_sheets'&&<SheetPreview/>}{record.system==='jira'&&<TicketPreview azure={false}/>} {record.system==='azure_boards'&&<TicketPreview azure/>}{record.system==='sharepoint'&&<DecisionPreview/>}{record.system==='github_actions'&&<TestPreview azure={false}/>} {record.system==='azure_pipelines'&&<TestPreview azure/>}{record.system==='entra_id'&&<IdentityPreview okta={false}/>} {record.system==='okta'&&<IdentityPreview okta/>}{record.system==='terraform_cloud'&&<TerraformPreview/>}{record.system==='servicenow'&&<ExceptionPreview/>}{record.system==='vanta'&&<VantaPreview/>}</div><div className="trace-footer"><span>Linked requirement</span><strong>{record.kind} → AC-2</strong><b>{record.status}</b></div></aside>}

function ConfluencePreview(){return <><div className="crumbs">Wexler Security · Standards · Identity</div><h2>Privileged access authentication</h2><div className="author-row"><span>PO</span><p>Patricia Okafor<br/><small>Updated Aug 26, 2026</small></p></div><div className="doc-status">APPROVED · WSEC-1 · VERSION 4.2</div><h3>AC-2 · Requirement</h3><p>All privileged human access to production infrastructure must be authenticated with multi-factor authentication.</p><div className="info-box"><b>Control intent</b><p>Prevent unauthorized privileged access across production and Gov Cloud workloads.</p></div></>}
function SheetPreview(){return <><div className="sheet-tabs"><span>Wexler SOC2 matrix</span><b>Share</b></div><div className="formula">fx&nbsp;&nbsp; =CONTROL_MAP(B114)</div><div className="sheet-grid"><b></b><b>A</b><b>B</b><b>C</b><b>113</b><span>AC-1</span><span>Account governance</span><span className="green-cell">Effective</span><b>114</b><span>AC-2</span><span>Privileged access requires MFA</span><span className="amber-cell">Affected</span><b>115</b><span>AC-3</span><span>Access enforcement</span><span className="green-cell">Effective</span></div></>}
function TicketPreview({azure}:{azure:boolean}){return <><div className="ticket-head"><span>{azure?'Azure DevOps · Wexler Engineering · Boards':'Jira Software · Platform Engineering'}</span><b>{azure?'User Story 12844':'PLAT-4488'}</b></div><div className="ticket-title-row"><div><small>{azure?'Identity Platform / Release Security':'PLAT · Identity modernization'}</small><h2>{azure?'Enforce Conditional Access on Azure DevOps release pipelines':'Roll out FIDO2 security keys to Platform Identity administrators'}</h2></div><div className="ticket-state">● In progress</div></div><div className="source-meta-grid"><div><span>Assigned to</span><b>{azure?'Sanjay Raghunathan':'Patricia Okafor'}</b></div><div><span>{azure?'Area path':'Reporter'}</span><b>{azure?'Wexler\\Identity Platform':'Marcus Chen'}</b></div><div><span>{azure?'Iteration':'Sprint'}</span><b>{azure?'Identity\\Sprint 42':'Platform Sprint 41'}</b></div><div><span>Priority</span><b>{azure?'1 · Critical':'High'}</b></div><div><span>Parent</span><b>{azure?'Feature 12791':'PLAT-4401'}</b></div><div><span>Due</span><b>Sep 12, 2026</b></div></div><section className="source-section"><h3>Description</h3><p>{azure?'Block production release stages unless the initiating identity satisfies CA-0031. Service connections must use workload identity federation and must not retain client secrets.':'Issue phishing-resistant credentials to all 38 privileged administrators, register two keys per user, and remove SMS and TOTP from the privileged authentication strength policy.'}</p></section><section className="source-section"><h3>Acceptance criteria</h3><label><input type="checkbox" checked readOnly/> {azure?'Production stages resolve the initiating user and service connection':'38 administrators have two registered FIDO2 keys'}</label><label><input type="checkbox" checked={azure} readOnly/> {azure?'CA-0031 evaluation is written to the release audit log':'Recovery process tested with Security Operations'}</label><label><input type="checkbox" readOnly/> {azure?'Client-secret service connections are replaced with federation':'SMS, TOTP, and push removed from the privileged policy'}</label><label><input type="checkbox" readOnly/> Evidence is attached to AC-2 and CTL-114</label></section><div className="native-warning"><b>Control linkage changed</b><br/>AC-2 v3 adds phishing resistance, workload identities, and a 90-day access review. Existing acceptance criteria cover only part of the obligation.</div><section className="source-section"><h3>Links</h3><div className="linked-row"><span>{azure?'Test run #913':'GitHub run #4471'}</span><b>Passing</b></div><div className="linked-row"><span>CTL-114 · Privileged access MFA</span><b>Affected</b></div><div className="linked-row"><span>AC-2 v3 · Privileged authentication</span><b>Draft</b></div></section><section className="source-section"><h3>Activity</h3><div className="activity-entry"><b>{azure?'Sanjay Raghunathan':'Patricia Okafor'}</b><small>Today · 11:18</small><p>{azure?'Pipeline gate is working in staging. Waiting on the service-connection inventory from Cloud Platform.':'Key distribution is complete for 31 of 38 administrators. The remaining users are in APAC.'}</p></div></section></>}
function DecisionPreview(){return <><div className="crumbs">SharePoint · Architecture Decisions · Identity</div><span className="decision-number">ADR-024 · ACCEPTED</span><h2>Break-glass credentials remain outside the identity provider</h2><p><b>Context.</b> Regional control planes must remain accessible during a primary identity-provider outage.</p><p><b>Decision.</b> Maintain separately governed emergency credentials with monitored retrieval.</p><div className="approval-stamp">Approved by Architecture Review Board · Feb 2026</div></>}
function TestPreview({azure}:{azure:boolean}){return <><div className="run-head"><span>{azure?'Azure Pipelines · wexler-gov/drift-check':'GitHub Actions · wexler/identity-policy'}</span><b>✓ Run #{azure?'913':'4471'}</b></div><h2>{azure?'Service-principal credential age':'Conditional Access policy verification'}</h2><div className="source-meta-grid"><div><span>Branch</span><b>{azure?'refs/heads/main':'main'}</b></div><div><span>Commit</span><b className="mono">{azure?'7b2e9af':'a81cf42'}</b></div><div><span>Triggered by</span><b>{azure?'Scheduled policy':'terraform-cloud[bot]'}</b></div><div><span>Environment</span><b>{azure?'Azure Gov':'entra-production'}</b></div></div><div className="run-summary"><strong>All checks passed</strong><span>4 jobs · Completed in 48s</span></div>{['Checkout policy repository','Evaluate deployed configuration','Assert MFA is required','Upload signed attestation'].map((x,i)=><div className="check-row" key={x}><span>✓</span><p>{x}</p><small>{12+i*4}s</small></div>)}<section className="source-section"><h3>Artifacts and attestations</h3><div className="linked-row"><span>conditional-access-evaluation.json</span><b>SHA256 verified</b></div><div className="linked-row"><span>AC-2 / CTL-114 evidence bundle</span><b>Uploaded</b></div></section><div className="native-warning"><b>Semantic coverage gap</b><br/>The assertion checks whether MFA is required. It does not verify that only phishing-resistant factors are accepted.</div></>}
function IdentityPreview({okta}:{okta:boolean}){return <><div className="identity-head">{okta?'Okta Admin Console · Wexler Acquired BU':'Microsoft Entra admin center · Wexler Systems'}</div><div className="crumbs">Protection · {okta?'Directory / Groups':'Conditional Access'} · Policies</div><h2>{okta?'Contractor production administrators':'CA-0031 · Privileged MFA policy'}</h2><span className="enabled-pill">● {okta?'ACTIVE':'ON'}</span><div className="source-meta-grid"><div><span>Owner</span><b>{okta?'BU Identity Operations':'Platform Identity'}</b></div><div><span>Last modified</span><b>{okta?'Feb 14, 2026':'Aug 22, 2026'}</b></div><div><span>Assignments</span><b>{okta?'74 users':'12 directory roles'}</b></div><div><span>Exceptions</span><b>{okta?'3 users':'2 break-glass accounts'}</b></div></div><section className="source-section"><h3>Assignments</h3><div className="linked-row"><span>Included</span><b>{okta?'grp_contractor_prod':'Global, Security, Exchange administrators'}</b></div><div className="linked-row"><span>Applications</span><b>{okta?'AWS Production, PagerDuty':'All cloud applications'}</b></div><div className="linked-row"><span>Locations</span><b>Any location</b></div></section><section className="source-section"><h3>Access controls</h3><div className="linked-row"><span>Grant</span><b>{okta?'TOTP or FIDO2':'Require multifactor authentication'}</b></div><div className="linked-row"><span>Authentication strength</span><b>{okta?'Any enrolled factor':'Multifactor authentication'}</b></div><div className="linked-row"><span>Sign-in frequency</span><b>{okta?'12 hours':'Every 8 hours'}</b></div></section><div className="native-warning"><b>Requirement mismatch</b><br/>The current policy permits {okta?'TOTP':'SMS, TOTP, and push'}, while AC-2 v3 permits phishing-resistant factors only.</div></>}
function TerraformPreview(){return <><div className="terraform-head">Terraform Cloud · wexler-identity-prod</div><div className="ticket-title-row"><div><small>Workspace / Production / Identity</small><h2>Run run-8Kq2mT</h2></div><div className="plan-status">✓ Applied</div></div><div className="source-meta-grid"><div><span>Configuration</span><b className="mono">a81cf42</b></div><div><span>Triggered by</span><b>GitHub merge</b></div><div><span>Terraform</span><b>1.9.3</b></div><div><span>Policy checks</span><b>6 passed</b></div></div><div className="plan-code"><span>Plan: 2 to add, 1 to change, 0 to destroy</span><p>~ azuread_conditional_access_policy.privileged_mfa</p><em>+ include_roles = [&quot;Global Administrator&quot;]</em><em>- allowed_factors = [&quot;sms&quot;, &quot;totp&quot;, &quot;fido2&quot;]</em></div><section className="source-section"><h3>Run stages</h3><div className="linked-row"><span>Plan finished</span><b>08:42 · 31s</b></div><div className="linked-row"><span>Sentinel policy checks</span><b>6 / 6 passed</b></div><div className="linked-row"><span>Apply approved by</span><b>Amelia Brooks</b></div><div className="linked-row"><span>State version</span><b>sv-9dG1kP</b></div></section></>}
function ExceptionPreview(){return <><div className="ticket-head"><span>ServiceNow · Risk Exceptions</span><b>RITM0084412</b></div><div className="ticket-title-row"><div><small>Requested item · Security policy exception</small><h2>Contractor SRE authentication exception</h2></div><span className="exception-state">Requires reapproval</span></div><div className="source-meta-grid"><div><span>Requested for</span><b>Bangalore Support Org</b></div><div><span>Risk owner</span><b>Dana Lindqvist</b></div><div><span>Opened</span><b>Apr 10, 2026</b></div><div><span>Expires</span><b>Oct 10, 2026</b></div><div><span>Residual risk</span><b>Moderate</b></div><div><span>Approval group</span><b>Security Risk Council</b></div></div><section className="source-section"><h3>Business justification</h3><p>Hardware security keys have not been issued to contractor administrators supporting APAC production incidents. TOTP is temporarily permitted for 14 named accounts.</p></section><section className="source-section"><h3>Compensating controls</h3><label><input type="checkbox" checked readOnly/> Access limited to approved support shifts</label><label><input type="checkbox" checked readOnly/> Splunk alert on every privileged sign-in</label><label><input type="checkbox" checked readOnly/> Weekly manager review of group membership</label></section><div className="native-warning"><b>Reapproval required</b><br/>The approved relief permits TOTP. AC-2 v3 removes that fallback, so the exception must be reassessed before policy approval.</div><section className="source-section"><h3>Approval history</h3><div className="activity-entry"><b>Dana Lindqvist · Risk owner</b><small>Apr 10 · Approved for 180 days</small><p>Approval conditional on weekly access review and security-key procurement.</p></div></section></>}
function VantaPreview(){return <><div className="vanta-head">Vanta · Continuous monitoring · Identity</div><h2>MFA enforcement across privileged accounts</h2><div className="source-meta-grid"><div><span>Control</span><b>AC-2 / CTL-114</b></div><div><span>Frameworks</span><b>SOC 2 · ISO 27001</b></div><div><span>Owner</span><b>Security Assurance</b></div><div><span>Last checked</span><b>4 minutes ago</b></div></div><div className="monitor-score"><strong>82%</strong><span>18 of 22 resources passing</span></div><div className="monitor-bar"><i style={{width:'82%'}}/></div><section className="source-section"><h3>Resources requiring attention</h3><div className="linked-row"><span>Okta · grp_contractor_prod</span><b>2 groups</b></div><div className="linked-row"><span>Entra · emergency-access</span><b>1 account</b></div><div className="linked-row"><span>Azure · legacy-deploy-sp</span><b>1 principal</b></div></section><section className="source-section"><h3>Evidence collection</h3><div className="linked-row"><span>Entra policy export</span><b>Current</b></div><div className="linked-row"><span>Okta group membership</span><b>196 days old</b></div><div className="linked-row"><span>Terraform state</span><b>Current</b></div></section></>}

function ChangeView({before,onAnalyze}:{before:string;onAnalyze:()=>void}){return <><PageTitle kicker="Policy change · AC-2" title="Privileged access authentication" description="Review the proposed requirement against the currently approved language and its linked control scope."/><div className="change-compare"><article><div className="compare-head"><span>Approved · AC-2 v2</span><b>Confluence</b></div><h2>Current requirement</h2><p>{before}</p><div className="assertions"><span>MFA required</span><span>Weak fallback permitted</span><span>Humans + contractors</span></div></article><div className="ripple-arrow">→</div><article className="proposed"><div className="compare-head"><span>Proposed · AC-2 v3</span><b>Draft</b></div><h2>Proposed requirement</h2><p>{proposedRequirement.text}</p><div className="assertions"><span>Phishing-resistant only</span><span>No fallback</span><span>90-day review</span><span>Workload identities added</span></div></article></div><div className="analysis-callout"><div><span className="section-label">Change control</span><h3>13 linked records require review before approval.</h3><p>Source records remain unchanged until their owners approve the corresponding action.</p></div><button className="rt-primary" onClick={onAnalyze}>Refresh impact review</button></div></>}

function ImpactView({analyzed,findings,proposals,decisions,reviewId,constraintApplied,exceptions,onAnalyze,onDraft,onDecide,onPushBack,onReapprove,onInspect}:{analyzed:boolean;findings:Finding[];proposals:Proposal[];decisions:Record<string,Decision>;reviewId:string|null;constraintApplied:boolean;exceptions:Exception[];onAnalyze:()=>void;onDraft:()=>void;onDecide:(id:string,d:Decision)=>void;onPushBack:()=>void;onReapprove:(id:string)=>void;onInspect:(id:string)=>void}){
  if(!analyzed) return <EmptyImpact onAnalyze={onAnalyze}/>;
  const counts=findings.reduce<Record<string,number>>((a,f)=>({...a,[f.kind]:(a[f.kind]||0)+1}),{});
  const byFinding=(id:string)=>proposals.filter((p)=>p.derivedFromFindingId===id);
  const constraintProposals=proposals.filter((p)=>p.derivedFromFindingId==='reviewer-constraint');
  const adoption=proposals.find((p)=>p.kind==='requirement_version');
  // A proposal whose finding has since been resolved must not silently vanish
  // while it is still pending: it stays reviewable here, and the audit packet
  // records whatever a person decided about it.
  const findingIds=new Set(findings.map((f)=>f.id));
  const orphaned=proposals.filter((p)=>p.kind!=='requirement_version'&&p.derivedFromFindingId!=='reviewer-constraint'&&!findingIds.has(p.derivedFromFindingId??''));
  return <>
    <PageTitle kicker={`Impact review${reviewId?` · ${reviewId}`:''}`} title={`${findings.length} grounded consequences require attention`} description="Every claim below is derived from structured assertions and cites the exact enterprise records that produced it."/>
    <div className="impact-summary">{[['New scope',(counts.coverage_gap||0)+(counts.scope_expansion||0)],['Controls',counts.control_insufficient||0],['Tests',counts.test_invalidated||0],['Exceptions',counts.exception_conflict||0],['Work items',counts.work_stale||0]].map(([l,n])=><div key={String(l)}><strong>{n}</strong><span>{l}</span></div>)}</div>
    {!reviewId&&<div className="review-boundary"><div><b>Analysis is complete. No remediation proposals exist yet.</b><span>Ask the agent to call <code>create_impact_review</code>, or draft it here. Drafting is allowed; approval is not.</span></div><button className="rt-primary" onClick={onDraft}>Draft proposals</button></div>}
    {reviewId&&!constraintApplied&&<div className="review-boundary constraint"><div><b>Do the proposals hold against what you know?</b><span>Break-glass credentials for the regional control planes cannot depend on Entra ID — that is the condition they exist for. Tell the agent, and it will propose a compensating path rather than argue.</span></div><button className="rt-primary" onClick={onPushBack}>Raise the break-glass constraint</button></div>}
    {adoption&&<div className="adoption-block"><div className="section-label">The policy change itself</div><p>The agent analyzed this change, derived its consequences and drafted every remediation below — and it still cannot adopt the policy. Until a person approves this row, AC-2 v2 remains the requirement the graph is measured against.</p><ProposalLine proposal={adoption} decision={decisions[adoption.id]||'pending'} onDecide={onDecide}/></div>}
    {constraintProposals.length>0&&<div className="constraint-block"><div className="section-label">Accepted interpretation · raised by Dana Lindqvist</div><p>Break-glass retrieval must not depend on the identity provider. The agent did not overwrite the requirement; it proposed a compensating path and left the decision here.</p>{constraintProposals.map((p)=><ProposalLine key={p.id} proposal={p} decision={decisions[p.id]||'pending'} onDecide={onDecide}/>)}</div>}
    {exceptions.filter((e)=>e.status==='requires_reapproval').length>0&&<div className="constraint-block"><div className="section-label">Exceptions awaiting a risk decision</div><p>An exception is a person accepting a risk in their own name. Reapproving one is the fourth operation the agent has no tool for.</p>{exceptions.filter((e)=>e.status==='requires_reapproval').map((e)=><div key={e.id} className="proposal-line"><div><span>{e.code} · {e.sourceRef.system}:{e.sourceRef.ref} · expires {e.expiresAt}</span><strong>{e.title}</strong><small>{e.reason}</small></div><div><button onClick={()=>onReapprove(e.id)}>Reapprove exception</button></div></div>)}</div>}
    {orphaned.length>0&&<div className="adoption-block"><div className="section-label">Still open · originating finding already resolved</div><p>These were drafted against findings that no longer reproduce, because the control behind them has since been fixed. They stay decidable rather than disappearing, so the audit packet can say what happened to every one of them.</p>{orphaned.map((p)=><ProposalLine key={p.id} proposal={p} decision={decisions[p.id]||'pending'} onDecide={onDecide}/>)}</div>}
    <div className="finding-list">{findings.map((f)=>{
      const recordIds=[...new Set([...f.entityIds,...f.derivation.comparedEntityIds])].filter((id)=>id!=='AC-2@3');
      const linked=byFinding(f.id);
      return <article key={f.id} className={`finding ${linked.every((p)=>decisions[p.id]&&decisions[p.id]!=='pending')&&linked.length?'approved':''}`}>
        <div className={`severity ${f.severity}`}>{f.severity}</div>
        <div className="finding-body">
          <div><span>{f.id} · {f.kind.replaceAll('_',' ')}</span><h3>{f.summary}</h3></div>
          <div className="record-citations">{recordIds.map((id)=><button key={id} onClick={()=>onInspect(id)}>{id} ↗</button>)}</div>
          <details><summary>Why this was flagged</summary><div className="derivation"><p><b>Rule</b>{f.derivation.rule}</p><p><b>Expected</b>{f.derivation.expected}</p><p><b>Observed</b>{f.derivation.observed}</p></div></details>
          {linked.map((p)=><ProposalLine key={p.id} proposal={p} decision={decisions[p.id]||'pending'} onDecide={onDecide}/>)}
        </div>
      </article>;
    })}</div>
  </>;
}

/**
 * One proposal, with what it would actually change.
 *
 * The payload is rendered, not summarised: a reviewer approving this is
 * approving a specific configuration, and after approval the analyzer re-runs
 * against the mutated graph. That is why the readiness score moves.
 */
function ProposalLine({proposal,decision,onDecide}:{proposal:Proposal;decision:Decision;onDecide:(id:string,d:Decision)=>void}){
  const properties=(proposal.payload.properties??proposal.payload.assertions) as {kind:string}[]|undefined;
  const criteria=proposal.payload.acceptanceCriteria as string[]|undefined;
  return <div className={`proposal-line ${decision}`}>
    <div>
      <span>{proposal.id} · draft {proposal.kind.replaceAll('_',' ')}{proposal.targetEntityId?` · ${proposal.targetEntityId}`:''}</span>
      <strong>{proposal.title}</strong>
      {properties&&properties.length>0&&<small>Would set: {properties.map((a)=>describeAssertion(a as never)).join('; ')}</small>}
      {criteria&&criteria.length>0&&<small>Acceptance: {criteria.join(' · ')}</small>}
    </div>
    {decision==='pending'
      ? <div><button onClick={()=>onDecide(proposal.id,'rejected')}>Reject</button><button onClick={()=>onDecide(proposal.id,'approved')}>Approve</button></div>
      : <b className={decision}>{decision==='approved'?'✓':'✕'} {decision} by Dana Lindqvist</b>}
  </div>;
}

function EmptyImpact({onAnalyze}:{onAnalyze:()=>void}){return <div className="empty-impact"><div className="empty-symbol">↯</div><span className="section-label">Impact review unavailable</span><h1>Refresh the linked records.</h1><p>Reconcile the AC-2 obligation with controls, tests, exceptions, evidence, and in-flight work.</p><button className="rt-primary" onClick={onAnalyze}>Refresh records</button></div>}

function ExecutionView({entities,findings,proposals,analyzed,approved,decisions}:{entities:Entity[];findings:Finding[];proposals:Proposal[];analyzed:boolean;approved:number;decisions:Record<string,Decision>}){const work=entities.filter((e):e is WorkItem=>e.kind==='work_item');const affected=new Set(findings.filter((f)=>f.kind==='work_stale').flatMap((f)=>f.entityIds));return <><PageTitle kicker="Connected delivery" title="Approved decisions become governed downstream work." description="Jira and Azure Boards remain systems of record. RippleTrace shows what would be updated and records the human authority behind each transition."/><div className="execution-stats"><span>{work.length} linked work items</span><span>{analyzed?affected.size:0} stale after change</span><span>{approved} approved responses</span></div>{approved>0&&<div className="writeback-banner"><b>Authorized execution plan</b><span>{approved} approved proposal{approved===1?'':'s'} queued for owner-controlled write-back. No hidden mutation occurred.</span></div>}<div className="work-columns">{['backlog','in_progress','in_review','done'].map((status)=><section key={status}><div className="column-head"><strong>{status.replace('_',' ')}</strong><span>{work.filter((w)=>w.status===status).length}</span></div>{work.filter((w)=>w.status===status).map((w)=>{const finding=findings.find((f)=>f.entityIds.includes(w.id));const proposal=finding?proposals.find((x)=>x.derivedFromFindingId===finding.id):undefined;const decision=proposal?decisions[proposal.id]:undefined;return <article key={w.id} className={analyzed&&affected.has(w.id)?'affected':''}><div><span>{sourceLabels[w.sourceRef.system]}</span><b>{w.sourceRef.ref}</b></div><h3>{w.title}</h3><p>{w.team} · {w.assignee||'Unassigned'}</p>{decision==='approved'?<em className="authorized">Approved remediation queued · {proposal?.id}</em>:analyzed&&affected.has(w.id)&&<em>Acceptance criteria stale · human decision pending</em>}</article>})}</section>)}</div></>}

function EvidenceView({entities,findings,analyzed,onInspect}:{entities:Entity[];findings:Finding[];analyzed:boolean;onInspect:(id:string)=>void}){const req=entities.find((e)=>e.id==='AC-2@2')!;const control=entities.find((e)=>e.id==='CTL-114')!;const test=entities.find((e)=>e.id==='test-entra-ca-mfa-required')!;const evidence=entities.find((e)=>e.id==='EV-01')!;return <><PageTitle kicker="Proof with provenance" title="A green check is not the same as valid proof." description="Open every node to inspect its native identifier, observed value, and relationship provenance."/><div className="evidence-chain">{[req,control,test,evidence].map((e,i)=><button onClick={()=>onInspect(e.id)} key={e.id} className={analyzed&&['CTL-114','test-entra-ca-mfa-required','EV-01'].includes(e.id)?'affected':''}><span>{e.kind.replace('_',' ')}</span><strong>{e.id}</strong><h3>{e.title}</h3><p>{sourceLabels[e.sourceRef.system]} · {e.sourceRef.ref}</p>{i<3&&<i>→</i>}</button>)}</div>{analyzed&&<div className="proof-break"><div>!</div><section><span className="section-label">Proof gap</span><h2>GitHub is green. AC-2 v3 is not proven.</h2><p>{findings.find((f)=>f.kind==='test_invalidated')?.summary}</p></section></div>}<section className="surface provenance-table"><div className="surface-head"><div><span className="section-label">Trace provenance</span><h2>Every relationship identifies who asserted it and why.</h2></div></div>{[['CTL-114 → AC-2','Control implements requirement','Google Sheets · SOC2-matrix!B114','Verified Jun 2026'],['Test → CTL-114','Test verifies only generic MFA','GitHub Actions · ca-policy.yml','Passing Aug 25'],['EV-01 → CTL-114','Export captures deployed policy','Entra ID · CA-0031','Collected Aug 2']].map((r)=><div className="prov-row" key={r[0]}>{r.map((x,i)=><span key={x} className={i===0?'mono':''}>{x}</span>)}</div>)}</section></>}

function AgentTimeline({events}:{events:ToolEvent[]}){const completed=events.filter((event)=>event.phase==='completed');return <div className="agent-timeline"><div className="timeline-head"><div><span className="section-label">Live agent investigation</span><strong>{completed.length?`${completed.length} tools completed`:'Waiting for agent'}</strong></div><b className={completed.length?'active':''}>{completed.length?'LIVE':'READY'}</b></div>{events.length===0?<p className="timeline-empty">Open your WebMCP agent and ask it to investigate AC2-CHG-2026-017. Every call will appear here.</p>:<div className="timeline-events">{events.slice(0,8).map((event,index)=><div key={`${event.at}-${event.name}-${index}`} className={`timeline-event ${event.phase}`}><i>{event.phase==='completed'?'✓':event.phase==='failed'?'!':'…'}</i><div><code>{event.name}</code><span>{event.phase} · {new Date(event.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span></div></div>)}</div>}</div>}

function EvidenceDrawer({id,entities,findings,edges,onClose}:{id:string;entities:Entity[];findings:Finding[];edges:TraceEdge[];onClose:()=>void}){const record=entities.find((entity)=>entity.id===id);if(!record)return <aside className="evidence-drawer"><header><div><span>Source record</span><strong>{id}</strong></div><button onClick={onClose} aria-label="Close evidence drawer">×</button></header><div className="drawer-empty">This identifier represents the proposed change rather than an approved source-system record.</div></aside>;const related=findings.filter((finding)=>finding.entityIds.includes(id)||finding.derivation.comparedEntityIds.includes(id));const links=edges.filter((edge)=>edge.from===id||edge.to===id);const detail=record as unknown as Record<string,unknown>;return <aside className="evidence-drawer"><header><div><span>{sourceLabels[record.sourceRef.system]} · {record.kind.replaceAll('_',' ')}</span><strong>{record.id}</strong></div><button onClick={onClose} aria-label="Close evidence drawer">×</button></header><div className="drawer-source"><span>Native source reference</span><b>{record.sourceRef.ref}</b><small>Represented system of record · deterministic demo data</small></div><section><span className="section-label">Record</span><h2>{record.title}</h2><div className="drawer-fields">{Object.entries(detail).filter(([key,value])=>!['id','kind','title','sourceRef','assertions','properties','grounds','acceptanceCriteria'].includes(key)&&['string','number','boolean'].includes(typeof value)).map(([key,value])=><div key={key}><span>{key.replaceAll('_',' ')}</span><b>{String(value)}</b></div>)}</div>{['assertions','properties','grounds','acceptanceCriteria'].map((key)=>detail[key]?<div className="structured-field" key={key}><span>{key.replaceAll('_',' ')}</span><pre>{JSON.stringify(detail[key],null,2)}</pre></div>:null)}</section><section><span className="section-label">Grounded findings</span>{related.length?related.map((finding)=><div className="drawer-finding" key={finding.id}><b>{finding.id} · {finding.severity}</b><p>{finding.summary}</p></div>):<p className="drawer-muted">No current AC-2 v3 finding cites this record.</p>}</section><section><span className="section-label">Relationship provenance</span>{links.slice(0,6).map((edge)=><div className="drawer-link" key={edge.id}><code>{edge.from} → {edge.to}</code><b>{edge.type}</b><p>{edge.provenance.rationale}</p><small>{edge.provenance.createdBy} · {edge.provenance.state}</small></div>)}</section></aside>}

function Readiness({score,baseline,after,analyzed,components}:{score:number;baseline:number;after:number;analyzed:boolean;components:{label:string;score:number;weight:number}[]}){return <div className="readiness-panel"><div className="section-label">Assurance readiness</div><div className="score"><strong>{score}</strong><span>/100</span></div><div className="score-bar"><i style={{width:`${score}%`}}/></div>{analyzed&&<div className="score-delta"><span>Before {baseline}</span><b>→</b><span>After {after}</span></div>}<div className="component-list">{components.map((c)=><div key={c.label}><span>{c.label}<small>{Math.round(c.weight*100)}%</small></span><strong>{Math.round(c.score*100)}%</strong></div>)}</div></div>}
function ReviewQueue({decided,total}:{decided:number;total:number}){return <div className="journey"><div className="section-label">Review queue</div><button><i>{total-decided}</i><span>Pending decisions<small>AC-2 policy change</small></span></button><button><i>2</i><span>Owner responses due<small>Platform Identity · Cloud SRE</small></span></button><button><i>1</i><span>Exception expiring<small>ServiceNow · Oct 10</small></span></button></div>}
