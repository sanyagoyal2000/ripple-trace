/**
 * Deterministic layered layout for the traceability graph.
 *
 * Hand-written rather than pulled from a layout library: the graph has a fixed
 * semantic left-to-right order (requirement → control → work → test →
 * evidence), so a generic force or hierarchical layout would do strictly less
 * than one that knows what a column means. It also keeps positions stable
 * across renders, so a tool call highlights nodes instead of reshuffling the
 * canvas under the judge's cursor.
 */

import type { GraphIndex } from './graph';
import type { Entity, EntityKind } from './types';

const COLUMN: Record<EntityKind, number> = {
  standard: -1,
  requirement: 0,
  control: 1,
  work_item: 2,
  test: 3,
  evidence: 4,
  exception: 1,
  decision: 2,
};

/** Exceptions and decisions annotate the spine; they are not steps along it. */
const ASIDE: EntityKind[] = ['exception', 'decision'];

export const COLUMN_WIDTH = 268;
export const ROW_HEIGHT = 104;
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 76;
const ASIDE_INSET = 26;

export interface LaidOutNode {
  id: string;
  entity: Entity;
  x: number;
  y: number;
  aside: boolean;
}

export interface Layout {
  nodes: LaidOutNode[];
  width: number;
  height: number;
}

export function layoutGraph(
  index: GraphIndex,
  entityIds: string[],
  /** Maps an edge endpoint to the node representing it (AC-2 → AC-2@2). */
  resolveId: (id: string) => string = (id) => id,
): Layout {
  const entities = entityIds
    .map((id) => index.entities.get(id))
    .filter((e): e is Entity => Boolean(e) && e!.kind !== 'standard');

  const columns = new Map<number, Entity[]>();
  for (const entity of entities) {
    const column = COLUMN[entity.kind];
    columns.set(column, [...(columns.get(column) ?? []), entity]);
  }

  const rowOf = new Map<string, number>();
  const nodes: LaidOutNode[] = [];
  let maxRow = 0;

  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const members = columns.get(column)!;

    // Anchor each node near the average row of whatever already points at it,
    // so edges run mostly horizontally instead of crossing the canvas.
    const anchored = members
      .map((entity) => {
        const neighbours = [
          ...(index.outgoing.get(entity.id) ?? []).map((e) => resolveId(e.to)),
          ...(index.incoming.get(entity.id) ?? []).map((e) => resolveId(e.from)),
        ]
          .map((id) => rowOf.get(id))
          .filter((row): row is number => row !== undefined);
        return {
          entity,
          anchor: neighbours.length
            ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length
            : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => a.anchor - b.anchor || a.entity.id.localeCompare(b.entity.id));

    let spineRow = 0;
    let asideRow = 0;
    for (const { entity } of anchored) {
      const aside = ASIDE.includes(entity.kind);
      const row = aside ? asideRow++ : spineRow++;
      if (!aside) rowOf.set(entity.id, row);
      const y = aside ? (spineRow + row) * ROW_HEIGHT + ROW_HEIGHT / 2 : row * ROW_HEIGHT;
      maxRow = Math.max(maxRow, y / ROW_HEIGHT);
      nodes.push({
        id: entity.id,
        entity,
        x: column * COLUMN_WIDTH + (aside ? ASIDE_INSET : 0),
        y,
        aside,
      });
    }
  }

  const columnCount = Math.max(...[...columns.keys()], 0) + 1;
  return {
    nodes,
    width: columnCount * COLUMN_WIDTH + NODE_WIDTH,
    height: (maxRow + 1) * ROW_HEIGHT + NODE_HEIGHT,
  };
}

/** Edge anchor points, so the SVG and the node boxes agree. */
export function anchors(node: LaidOutNode) {
  return {
    out: { x: node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT / 2 },
    in: { x: node.x, y: node.y + NODE_HEIGHT / 2 },
  };
}
