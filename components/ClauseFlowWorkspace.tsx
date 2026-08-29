'use client';

import { useEffect, useMemo, useState } from 'react';
import { IMPACT_PROPOSALS, INITIAL_STATE, REVISED_STATEMENT } from '@/lib/demo-data';
import type { DemoState, Proposal, Requirement, Status } from '@/lib/types';
import { registerClauseFlowTools } from '@/lib/webmcp';

type View = 'standards' | 'graph' | 'board' | 'history';
const viewLabels: Record<View, string> = { standards: 'Standards workspace', graph: 'Traceability graph', board: 'Execution board', history: 'Decision history' };
const icons: Record<View, string> = { standards: '§', graph: '⌘', board: '▦', history: '↺' };

function cloneInitial(): DemoState { return JSON.parse(JSON.stringify(INITIAL_STATE)); }

export default function ClauseFlowWorkspace() {
  const [state, setState] = useState<DemoState>(cloneInitial);
  const [view, setView] = useState<View>('standards');
  const [selectedRequirement, setSelectedRequirement] = useState('IDS-01');
  const [toast, setToast] = useState('');
  const [toolsReady, setToolsReady] = useState(false);

  const readiness = state.analyzed ? Math.min(92, 61 + state.proposals.filter((p) => p.status === 'approved').length * 6) : 92;
  const selected = state.requirements.find((r) => r.id === selectedRequirement) ?? state.requirements[0];
  const unresolved = state.proposals.filter((p) => p.status === 'pending').length;

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };
  const analyze = () => {
    setState((current) => ({
      ...current,
      analyzed: true,
      requirements: current.requirements.map((r) => r.id === 'IDS-01' ? { ...r, previousStatement: r.statement, statement: REVISED_STATEMENT, version: 2, effectiveDate: '2026-09-15', status: 'affected' } : r.id === 'IDS-02' ? { ...r, status: 'affected' } : r),
      controls: current.controls.map((c) => ['CTRL-MFA-01', 'CTRL-REV-01', 'CTRL-BRG-01'].includes(c.id) ? { ...c, status: 'affected' } : c),
      exceptions: current.exceptions.map((e) => ({ ...e, status: 'needs-review' })),
      proposals: current.proposals.length ? current.proposals : IMPACT_PROPOSALS,
    }));
    setSelectedRequirement('IDS-01');
    notify('Impact review created — approved records remain unchanged.');
  };

  const decide = (proposalId: string, outcome: 'approved' | 'rejected') => {
    setState((current) => {
      const proposal = current.proposals.find((p) => p.id === proposalId);
      if (!proposal || proposal.status !== 'pending') return current;
      const now = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      return {
        ...current,
        proposals: current.proposals.map((p) => p.id === proposalId ? { ...p, status: outcome } : p),
        decisions: [{ id: `DEC-${String(current.decisions.length + 1).padStart(3, '0')}`, action: `${outcome === 'approved' ? 'Approved' : 'Rejected'}: ${proposal.title}`, actor: 'Avery Morgan', timestamp: now, rationale: outcome === 'approved' ? proposal.reason : 'Rejected during human impact review; no operational record changed.' }, ...current.decisions],
      };
    });
    notify(`Proposal ${outcome}. Decision history updated.`);
  };

  const report = () => ({ organization: 'Northstar Financial (synthetic)', standard: 'Northstar Identity Security Standard', readiness, pendingProposals: unresolved, coveredRequirements: state.requirements.filter((r) => r.status === 'covered').length, totalRequirements: state.requirements.length, evidence: state.evidence, decisions: state.decisions });

  useEffect(() => {
    const registered = registerClauseFlowTools({
      getRequirement: (id) => state.requirements.find((r) => r.id === id) ?? { error: 'Requirement not found' },
      getTraceabilityGraph: () => ({ requirements: state.requirements, controls: state.controls, workItems: state.workItems, evidence: state.evidence }),
      analyzeChangeImpact: (id) => { if (id !== 'IDS-01') return { error: 'The demo scenario supports IDS-01.' }; analyze(); return { requirementId: id, summary: 'The revision affects authentication strength, review cadence, implementation work, evidence, and one exception.', proposalCount: IMPACT_PROPOSALS.length }; },
      createImpactReview: () => { analyze(); return { status: 'draft', proposals: IMPACT_PROPOSALS }; },
      approveProposal: (id) => { decide(id, 'approved'); return { id, status: 'approved', actor: 'Avery Morgan' }; },
      rejectProposal: (id) => { decide(id, 'rejected'); return { id, status: 'rejected', actor: 'Avery Morgan' }; },
      generateTraceabilityReport: report,
    });
    setToolsReady(registered || Boolean(document.modelContext));
  }, [state]);

  const reset = () => { setState(cloneInitial()); setView('standards'); setSelectedRequirement('IDS-01'); notify('Synthetic workspace reset.'); };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">CF</div><div><strong>ClauseFlow</strong><span>Policy-to-execution workspace</span></div></div>
        <div className="top-actions"><span className="synthetic">● Synthetic workspace</span><span className={`webmcp ${toolsReady ? 'ready' : ''}`}>{toolsReady ? 'WebMCP ready' : 'WebMCP preview'}</span><button className="reset" onClick={reset}>Reset demo</button><span className="avatar">AM</span></div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">Northstar Financial</p><p className="workspace-caption">Identity assurance program</p>
          <nav>{(Object.keys(viewLabels) as View[]).map((key) => <button key={key} onClick={() => setView(key)} className={view === key ? 'active' : ''}><span>{icons[key]}</span>{viewLabels[key]}</button>)}</nav>
          <div className="readiness"><div className="readiness-head"><span>Coverage readiness</span><strong>{readiness}%</strong></div><div className="progress"><i style={{ width: `${readiness}%` }} /></div><p>{state.analyzed ? unresolved ? `${unresolved} decisions need review` : 'All proposed changes reviewed' : 'Current approved standard'}</p></div>
          <div className="privacy-note"><strong>Safe demo data</strong><p>All people, policies, evidence, and systems are fictional.</p></div>
        </aside>

        <section className="main-panel">
          {view === 'standards' && <StandardsView state={state} selected={selected} onSelect={setSelectedRequirement} onAnalyze={analyze} />}
          {view === 'graph' && <GraphView state={state} />}
          {view === 'board' && <BoardView state={state} />}
          {view === 'history' && <HistoryView state={state} readiness={readiness} />}
        </section>

        <ImpactPanel state={state} onAnalyze={analyze} onDecide={decide} onViewHistory={() => setView('history')} />
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow green">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function StatusPill({ status }: { status: Status }) { return <span className={`status ${status}`}>{status === 'affected' ? 'Needs review' : status}</span>; }

function StandardsView({ state, selected, onSelect, onAnalyze }: { state: DemoState; selected: Requirement; onSelect: (id: string) => void; onAnalyze: () => void }) {
  return <>
    <PageHeader eyebrow="Northstar identity security standard" title="Standards workspace" description="Turn policy requirements into controls, owned work, tests, and evidence—without losing the decisions in between." action={<button className="primary" onClick={onAnalyze}>{state.analyzed ? 'Re-run analysis' : 'Analyze policy change'}</button>} />
    {state.analyzed && <div className="change-banner"><span>Revision detected</span><p>IDS-01 moved from broad MFA to phishing-resistant authentication, and access reviews moved from annual to quarterly.</p></div>}
    <div className="content-grid">
      <section className="card requirements-card"><div className="card-title"><div><strong>Requirements</strong><span>Version {state.analyzed ? '2.0' : '1.0'} · {state.analyzed ? 'Effective Sep 15, 2026' : 'Approved Jul 1, 2026'}</span></div><span>{state.requirements.length} requirements</span></div>
        <div className="requirement-list">{state.requirements.map((r) => <button key={r.id} onClick={() => onSelect(r.id)} className={selected.id === r.id ? 'selected' : ''}><i className={r.status} /><div><span>{r.id}</span><strong>{r.title}</strong><p>{r.statement}</p></div><StatusPill status={r.status} /></button>)}</div>
      </section>
      <aside className="card detail-card"><div className="detail-id">{selected.id} · v{selected.version}.0</div><h2>{selected.title}</h2><p className="statement">{selected.statement}</p>{selected.previousStatement && <div className="previous"><span>Previous approved wording</span><p>{selected.previousStatement}</p></div>}<dl><div><dt>Owner</dt><dd>{selected.owner}</dd></div><div><dt>Effective</dt><dd>{selected.effectiveDate}</dd></div><div><dt>Status</dt><dd><StatusPill status={selected.status} /></dd></div></dl></aside>
    </div>
  </>;
}

function GraphView({ state }: { state: DemoState }) {
  const req = state.requirements.find((r) => r.id === 'IDS-01')!; const control = state.controls.find((c) => c.id === 'CTRL-MFA-01')!; const work = state.workItems.find((w) => w.id === 'WORK-37')!; const evidence = state.evidence.find((e) => e.id === 'EVD-104')!;
  return <><PageHeader eyebrow="Semantic lineage" title="Traceability graph" description="Every line explains why work exists and what proves that a requirement is operating." />
    <section className="card graph-card"><div className="graph-legend"><span><i className="covered" />Covered</span><span><i className="affected" />Affected</span><span><i className="proposed" />Agent proposed</span></div><div className="graph-flow">
      <GraphNode type="Requirement" id={req.id} title={req.title} status={req.status} /><Connector label="implemented by" affected={state.analyzed} /><GraphNode type="Control" id={control.id} title={control.title} status={control.status} /><Connector label="delivered by" affected={state.analyzed} /><GraphNode type="Work" id={work.id} title={work.title} status={state.analyzed ? 'affected' : 'covered'} /><Connector label="proved by" affected={state.analyzed} /><GraphNode type="Evidence" id={evidence.id} title={evidence.title} status={state.analyzed ? 'affected' : 'covered'} />
    </div>{state.analyzed && <div className="graph-callout"><strong>Semantic break detected</strong><p>The evidence proves MFA enrollment, but it does not prove that enrolled factors are phishing-resistant.</p></div>}</section>
  </>;
}

function GraphNode({ type, id, title, status }: { type: string; id: string; title: string; status: Status }) { return <div className={`graph-node ${status}`}><span>{type}</span><strong>{id}</strong><p>{title}</p></div>; }
function Connector({ label, affected }: { label: string; affected: boolean }) { return <div className={`connector ${affected ? 'affected' : ''}`}><span>{label}</span><i>→</i></div>; }

function BoardView({ state }: { state: DemoState }) {
  const items = [...state.workItems];
  if (state.proposals.some((p) => p.id === 'PROP-02' && p.status === 'approved')) items.unshift({ id: 'WORK-NEW-01', title: 'Issue passkeys to privileged workforce', controlId: 'CTRL-MFA-01', owner: 'Identity Team', sprint: 'Sprint 44', status: 'Backlog', provenance: 'agent', acceptanceCriteria: ['Passkeys issued to all privileged human accounts'] });
  if (state.proposals.some((p) => p.id === 'PROP-03' && p.status === 'approved')) items.unshift({ id: 'WORK-NEW-02', title: 'Move access reviews to quarterly cadence', controlId: 'CTRL-REV-01', owner: 'Governance Team', sprint: 'Sprint 44', status: 'Backlog', provenance: 'agent', acceptanceCriteria: ['Review scheduled every 90 days'] });
  return <><PageHeader eyebrow="Connected delivery" title="Execution board" description="Sprint work retains its policy origin, acceptance criteria, and approval provenance." /><section className="board">{(['Backlog','In progress','Completed'] as const).map((column) => <div className="board-column" key={column}><div className="column-title"><strong>{column}</strong><span>{items.filter((i) => i.status === column).length}</span></div>{items.filter((i) => i.status === column).map((item) => <article className="work-card" key={item.id}><div className="work-meta"><span>{item.id}</span>{item.provenance === 'agent' && <b>Agent proposed · approved</b>}</div><h3>{item.title}</h3><p>{item.owner} · {item.sprint}</p><div className="linked">↳ {item.controlId}</div></article>)}</div>)}</section></>;
}

function HistoryView({ state, readiness }: { state: DemoState; readiness: number }) {
  const report = useMemo(() => ({ coverage: `${readiness}%`, pending: state.proposals.filter((p) => p.status === 'pending').length, approved: state.proposals.filter((p) => p.status === 'approved').length, rejected: state.proposals.filter((p) => p.status === 'rejected').length }), [state, readiness]);
  return <><PageHeader eyebrow="Human accountability" title="Decision history" description="Every agent proposal remains attributable, reviewable, and separate from approved company truth." action={<button className="secondary" onClick={() => window.print()}>Print report</button>} /><div className="report-strip">{Object.entries(report).map(([k,v]) => <div key={k}><strong>{v}</strong><span>{k}</span></div>)}</div><section className="card timeline">{state.decisions.map((d) => <article key={d.id}><div className="timeline-dot" /><div><span>{d.id} · {d.timestamp}</span><h3>{d.action}</h3><p>{d.rationale}</p><small>Decision owner: {d.actor}</small></div></article>)}</section></>;
}

function ImpactPanel({ state, onAnalyze, onDecide, onViewHistory }: { state: DemoState; onAnalyze: () => void; onDecide: (id: string, outcome: 'approved' | 'rejected') => void; onViewHistory: () => void }) {
  if (!state.analyzed) return <aside className="impact-panel empty"><div className="impact-badge">Agent-ready workflow</div><div className="impact-illustration"><span>§</span><i>→</i><span>✓</span></div><h2>Trace policy into execution</h2><p>Run the prepared revision scenario to see how ClauseFlow finds downstream gaps without changing approved records.</p><button className="primary full" onClick={onAnalyze}>Run impact analysis</button><div className="tool-list"><strong>WebMCP surface</strong><span>7 structured tools</span><span>Human approval boundary</span><span>Visible shared state</span></div></aside>;
  const counts = { controls: 3, work: 2, tests: 1, exceptions: 1 };
  return <aside className="impact-panel"><div className="impact-top"><span className="impact-badge">Impact review</span><span>Draft</span></div><h2>Policy change detected</h2><p>Review the agent’s proposed consequences. Nothing becomes company truth until you decide.</p><div className="impact-counts">{Object.entries(counts).map(([label,n]) => <div key={label}><strong>{n}</strong><span>{label}</span></div>)}</div><div className="proposal-list">{state.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onDecide={onDecide} />)}</div><button className="history-link" onClick={onViewHistory}>Open decision history →</button></aside>;
}

function ProposalCard({ proposal, onDecide }: { proposal: Proposal; onDecide: (id: string, outcome: 'approved' | 'rejected') => void }) {
  return <article className={`proposal ${proposal.status}`}><div><span>{proposal.kind} · {proposal.id}</span><strong>{proposal.title}</strong><p>{proposal.reason}</p></div>{proposal.status === 'pending' ? <div className="proposal-actions"><button onClick={() => onDecide(proposal.id, 'rejected')}>Reject</button><button onClick={() => onDecide(proposal.id, 'approved')}>Approve</button></div> : <div className="decision-result">{proposal.status === 'approved' ? '✓ Approved by human' : '× Rejected by human'}</div>}</article>;
}
