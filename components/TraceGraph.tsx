'use client';

/**
 * Blast radius.
 *
 * The previous version of this view drew all seventy-odd nodes at once in fixed
 * kind-columns. It looked like an ER diagram: most of it offscreen, edges
 * averaging 750px, and no question you could answer by reading it.
 *
 * This one is built around the question an engineer actually asks before
 * touching something — *what breaks if I change this?* — so it is master-detail
 * like the tools that answer that question elsewhere: pick the thing on the
 * left, see what depends on it on the right, ordered by how far away it is.
 *
 * Two things stay from the old view, because they are the point of having a
 * graph at all: absence is stated in words on every node, and an edge nobody
 * has verified is drawn dashed.
 */

import { useMemo, useState } from 'react';
import {
  controlsFor,
  currentRequirement,
  currentRequirements,
  evidenceFor,
  isEvidenceStale,
  isUnverifiedLink,
} from '@/lib/ripple/graph';
import { entityHealth, type Tone } from '@/lib/ripple/health';
import { graphIndex, selectEntity, useRipple } from '@/lib/ripple/store';
import { toolsForView } from '@/lib/ripple/tools';
import type { Entity, TraceEdge } from '@/lib/ripple/types';

const NODE_W = 200;
const NODE_H = 72;
const COL_GAP = 44;
const ROW_GAP = 20;

/** How each system names itself in the products these records actually live in. */
const SYSTEM_LABEL: Record<string, string> = {
  confluence: 'Confluence',
  google_sheets: 'Sheets',
  jira: 'Jira',
  azure_boards: 'Azure Boards',
  sharepoint: 'SharePoint',
  github_actions: 'GitHub Actions',
  azure_pipelines: 'Azure Pipelines',
  entra_id: 'Entra ID',
  okta: 'Okta',
  aws: 'AWS',
  azure: 'Azure',
  terraform_cloud: 'Terraform',
  splunk: 'Splunk',
  datadog: 'Datadog',
  servicenow: 'ServiceNow',
  vanta: 'Vanta',
  throughline: 'RippleTrace',
};

/** The last path segment is what a person actually types into a search box. */
const nativeKey = (ref: string) => {
  const tail = ref.split('/').filter(Boolean).pop() ?? ref;
  return tail.length > 30 ? `…${tail.slice(-29)}` : tail;
};

const KIND_LABEL: Record<string, string> = {
  requirement: 'requirement',
  control: 'control',
  work_item: 'work',
  test: 'test',
  evidence: 'evidence',
  exception: 'exception',
  decision: 'decision',
};

const EDGE_LABEL: Record<TraceEdge['type'], string> = {
  implements: 'implements',
  fulfills: 'fulfills',
  verifies: 'verifies',
  evidences: 'evidences',
  excepts: 'excepts',
  documents: 'documents',
  depends_on: 'depends on',
};

const TONE_MARK: Record<Tone, string> = { ok: '●', attention: '▲', absent: '✕' };

interface Placed {
  id: string;
  entity: Entity;
  depth: number;
  x: number;
  y: number;
}

export function TraceGraph() {
  const today = useRipple((s) => s.today);
  const findings = useRipple((s) => s.findings);
  const highlighted = useRipple((s) => s.highlightedEntityIds);
  const selected = useRipple((s) => s.selectedEntityId);
  const index = useRipple(() => graphIndex());

  const requirements = useMemo(() => currentRequirements(index), [index]);
  const [focusId, setFocusId] = useState('AC-2');
  const [depth, setDepth] = useState(3);

  const focus = currentRequirement(index, focusId) ?? requirements[0];
  // This view spans the full width, so the authority panel's headline travels
  // with it rather than being dropped along with the rail.
  const registeredHere = toolsForView('graph').length;

  /**
   * Breadth-first from the focus, so a node's column is its distance from the
   * thing you are changing rather than its type. That is what makes the layout
   * answer the question: everything in column one is what the change touches
   * first, and nothing on screen is unreachable from what you selected.
   */
  const { placed, edges, width, height } = useMemo(() => {
    if (!focus) return { placed: [] as Placed[], edges: [] as TraceEdge[], width: 0, height: 0 };

    /**
     * Edges address a requirement by its stable id ("AC-2") while the node on
     * screen is the current version ("AC-2@2"), so expansion has to look under
     * both keys. Getting this wrong is silent: the walk simply finds nothing
     * and you are left staring at a single box.
     */
    const edgeKeys = (id: string) => {
      const entity = index.entities.get(id);
      return entity?.kind === 'requirement' ? [entity.id, entity.requirementId] : [id];
    };

    const depthOf = new Map<string, number>([[focus.id, 0]]);
    let frontier = [focus.id];
    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const touching = edgeKeys(id).flatMap((key) => [
          ...(index.outgoing.get(key) ?? []),
          ...(index.incoming.get(key) ?? []),
        ]);
        for (const edge of touching) {
          for (const other of [edge.from, edge.to]) {
            const resolved = currentRequirement(index, other)?.id ?? other;
            if (depthOf.has(resolved)) continue;
            const entity = index.entities.get(resolved);
            if (!entity || entity.kind === 'standard') continue;
            depthOf.set(resolved, d);
            next.push(resolved);
          }
        }
      }
      frontier = next;
    }

    const byDepth = new Map<number, Entity[]>();
    for (const [id, d] of depthOf) {
      const entity = index.entities.get(id);
      if (entity) byDepth.set(d, [...(byDepth.get(d) ?? []), entity]);
    }

    const placedNodes: Placed[] = [];
    let tallest = 0;
    for (const [d, group] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      group.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
      group.forEach((entity, row) => {
        placedNodes.push({
          id: entity.id,
          entity,
          depth: d,
          x: d * (NODE_W + COL_GAP),
          y: row * (NODE_H + ROW_GAP),
        });
      });
      tallest = Math.max(tallest, group.length);
    }

    const ids = new Set(placedNodes.map((n) => n.id));
    const drawn = index.edges.filter((e) => {
      const from = currentRequirement(index, e.from)?.id ?? e.from;
      const to = currentRequirement(index, e.to)?.id ?? e.to;
      return ids.has(from) && ids.has(to);
    });

    const columns = Math.max(...[...byDepth.keys()], 0) + 1;
    return {
      placed: placedNodes,
      edges: drawn,
      width: columns * (NODE_W + COL_GAP),
      height: Math.max(tallest * (NODE_H + ROW_GAP), 200),
    };
  }, [index, focus, depth]);

  const positions = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const resolve = (id: string) => currentRequirement(index, id)?.id ?? id;

  /**
   * Controls the analyzer reached that this subtree does not contain.
   *
   * These are the ones a person misses: they govern an identity class the
   * requirement now covers while being linked to some other requirement
   * entirely, so no amount of walking out from here would ever reach them.
   */
  const offGraph = useMemo(() => {
    const onScreen = new Set(placed.map((p) => p.id));
    const ids = new Set(
      findings
        .filter((f) => f.derivation.rule.includes('unlinked_candidate'))
        .flatMap((f) => f.entityIds)
        .filter((id) => !onScreen.has(id)),
    );
    return [...ids].map((id) => index.entities.get(id)).filter((e): e is Entity => Boolean(e));
  }, [findings, placed, index]);

  const affected = useMemo(() => new Set(findings.flatMap((f) => f.entityIds)), [findings]);
  const columnLabel = (d: number) => {
    const kinds = [...new Set(placed.filter((p) => p.depth === d).map((p) => KIND_LABEL[p.entity.kind]))];
    if (d === 0) return 'you are changing';
    return kinds.slice(0, 3).join(' · ');
  };
  const columns = [...new Set(placed.map((p) => p.depth))].sort((a, b) => a - b);

  return (
    <div className="blast">
      <div className="blast-head">
        <div>
          <span className="section-label">Dependency view</span>
          <h2>What breaks if this changes?</h2>
        </div>
        <div className="blast-head-right">
          <span className="blast-authority">
            <b>{registeredHere}</b> tools registered here · <s>4</s> never registered
          </span>
          <label className="blast-depth">
            depth
            <input type="range" min={1} max={4} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
            <b>{depth}</b>
          </label>
        </div>
      </div>

      <div className="blast-body">
        <aside className="blast-picker">
          {requirements.map((r) => {
            const health = entityHealth(index, r, today);
            const controls = controlsFor(index, r.requirementId);
            const stale = controls.flatMap((c) => evidenceFor(index, c.id)).filter((e) => isEvidenceStale(e, today)).length;
            return (
              <button
                key={r.requirementId}
                className={`blast-pick tone-${health.tone} ${focusId === r.requirementId ? 'active' : ''}`}
                onClick={() => setFocusId(r.requirementId)}
              >
                <span className="blast-pick-top">
                  <b>{r.code}</b>
                  <i className={`mark tone-${health.tone}`}>{TONE_MARK[health.tone]}</i>
                </span>
                <span className="blast-pick-title">{r.title}</span>
                <span className="blast-pick-meta">
                  {SYSTEM_LABEL[r.sourceRef.system]} · {controls.length} control{controls.length === 1 ? '' : 's'}
                  {stale > 0 && ` · ${stale} stale`}
                  {affected.has(r.id) && ' · affected'}
                </span>
              </button>
            );
          })}
        </aside>

        <div className="blast-canvas">
          <div className="blast-cols" style={{ width }}>
            {columns.map((d) => (
              <span key={d} className="blast-col-label" style={{ left: d * (NODE_W + COL_GAP), width: NODE_W }}>
                {columnLabel(d)}
              </span>
            ))}
          </div>

          <div className="blast-inner" style={{ width, height }}>
            <svg width={width} height={height} className="blast-edges">
              {edges.map((edge) => {
                const from = positions.get(resolve(edge.from));
                const to = positions.get(resolve(edge.to));
                if (!from || !to) return null;
                const forward = to.x >= from.x;
                const ax = forward ? from.x + NODE_W : from.x;
                const bx = forward ? to.x : to.x + NODE_W;
                const ay = from.y + NODE_H / 2;
                const by = to.y + NODE_H / 2;
                const mid = (ax + bx) / 2;
                const dashed = isUnverifiedLink(edge);
                return (
                  <g key={edge.id} className={dashed ? 'edge unverified' : 'edge'}>
                    <path
                      d={`M ${ax} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${bx} ${by}`}
                      fill="none"
                      strokeDasharray={dashed ? '5 4' : undefined}
                    />
                    <text x={mid} y={(ay + by) / 2 - 5} textAnchor="middle">
                      {EDGE_LABEL[edge.type]}
                    </text>
                  </g>
                );
              })}
            </svg>

            {placed.map((node) => {
              const health = entityHealth(index, node.entity, today);
              const label = 'code' in node.entity && node.entity.code ? node.entity.code : node.entity.id;
              return (
                <button
                  key={node.id}
                  className={[
                    'blast-node',
                    `tone-${health.tone}`,
                    node.depth === 0 ? 'focus' : '',
                    affected.has(node.id) ? 'affected' : '',
                    highlighted.includes(node.id) ? 'lit' : '',
                    selected === node.id ? 'selected' : '',
                  ].join(' ')}
                  style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                  onClick={() => selectEntity(selected === node.id ? null : node.id)}
                  onDoubleClick={() =>
                    node.entity.kind === 'requirement' && setFocusId(node.entity.requirementId)
                  }
                >
                  <span className="blast-node-top">
                    <em className={`sys sys-${node.entity.sourceRef.system}`}>
                      {SYSTEM_LABEL[node.entity.sourceRef.system] ?? node.entity.sourceRef.system}
                    </em>
                    <b title={node.entity.sourceRef.ref}>{nativeKey(node.entity.sourceRef.ref)}</b>
                  </span>
                  <span className="blast-node-title">{node.entity.title}</span>
                  <span className="blast-node-foot">
                    <i>{label}</i>
                    {health.reasons.length > 0 && <em>{health.reasons[0]}</em>}
                  </span>
                </button>
              );
            })}
          </div>

          {offGraph.length > 0 && (
            <div className="blast-offgraph">
              <div className="section-label">Not in this subtree · surfaced by analysis</div>
              <p>
                These govern an identity class {focus?.code} now covers, but they implement a different
                requirement — so no amount of walking out from here reaches them. A person would have to
                already know they existed.
              </p>
              <div className="blast-offgraph-row">
                {offGraph.map((entity) => (
                  <button key={entity.id} className="blast-node tone-absent static" onClick={() => selectEntity(entity.id)}>
                    <span className="blast-node-top">
                      <em className={`sys sys-${entity.sourceRef.system}`}>
                        {SYSTEM_LABEL[entity.sourceRef.system] ?? entity.sourceRef.system}
                      </em>
                      <b title={entity.sourceRef.ref}>{nativeKey(entity.sourceRef.ref)}</b>
                    </span>
                    <span className="blast-node-title">{entity.title}</span>
                    <span className="blast-node-foot">
                      <i>{'code' in entity && entity.code ? entity.code : entity.id}</i>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
