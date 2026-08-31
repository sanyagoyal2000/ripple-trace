/**
 * Actor context — the enforcement point for the agent/human boundary.
 *
 * RippleTrace registers no mutation tool with the agent. That alone is a
 * convention, and a convention is not a governance story: it lives in a tool
 * description, which is a polite request to a model. So the constraint is
 * enforced a second time, here, in code.
 *
 * Every tool handler runs inside `runAsTool`. Every write that changes approved
 * state calls `assertHumanActor` first. A write to approved state originating
 * from a tool handler therefore throws, no matter how it was reached — through
 * a path nobody anticipated, a future refactor, or a model that was told to try.
 */

export interface Actor {
  id: string;
  kind: 'human' | 'tool';
}

const HUMAN_UI: Actor = { id: 'human:ui', kind: 'human' };

let current: Actor = HUMAN_UI;

export class MutationBoundaryError extends Error {
  constructor(operation: string, actor: Actor) {
    super(
      `Refused: "${operation}" writes approved state and may only be performed by a human. ` +
        `Current actor is ${actor.id} (${actor.kind}). Agents may propose; humans approve.`,
    );
    this.name = 'MutationBoundaryError';
  }
}

export function currentActor(): Actor {
  return current;
}

/** Run a tool handler. Any approved-state write inside will throw. */
export function runAsTool<T>(toolName: string, fn: () => T): T {
  const previous = current;
  current = { id: `tool:${toolName}`, kind: 'tool' };
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** Run a human UI action, attributed to the person acting. */
export function runAsHuman<T>(actorId: string, fn: () => T): T {
  const previous = current;
  current = { id: actorId, kind: 'human' };
  try {
    return fn();
  } finally {
    current = previous;
  }
}

export function assertHumanActor(operation: string): Actor {
  const actor = current;
  if (actor.kind !== 'human') throw new MutationBoundaryError(operation, actor);
  return actor;
}

/**
 * The four operations that exist only as human actions. Named here so the UI
 * can render the boundary and so the tool registry can assert it never
 * registers one of them. Nothing in this list has a tool definition.
 */
export const HUMAN_ONLY_OPERATIONS = [
  {
    name: 'approve_proposal',
    description: 'Accept a proposal into approved state and write it into the graph.',
    where: 'Impact review — the Approve button on each proposal.',
  },
  {
    name: 'reject_proposal',
    description: 'Decline a proposal, with a recorded reason that reaches the audit packet.',
    where: 'Impact review — Reject.',
  },
  {
    name: 'edit_proposal',
    description: 'Amend a proposal before accepting it, for example correcting a trace link.',
    where: 'Impact review — Edit.',
  },
  {
    name: 'approve_exception',
    description: 'Grant or renew a risk exception carved out of a control.',
    where: 'Impact review — Reapprove exception.',
  },
] as const;
