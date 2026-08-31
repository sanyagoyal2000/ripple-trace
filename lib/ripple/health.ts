/**
 * Entity health, derived from the graph.
 *
 * The graph's job is to make *absence* visible, so health is not a colour
 * lookup: it returns the reasons in words, and the view renders those words on
 * the node. A judge should see what is wrong without consulting a legend and
 * without hovering.
 */

import {
  ageInDays,
  controlsFor,
  daysBetween,
  edgesTo,
  evidenceFor,
  isEvidenceStale,
  isExceptionExpiringSoon,
  testsFor,
  type GraphIndex,
} from './graph';
import type { Entity, IsoDate } from './types';

export type Tone = 'ok' | 'attention' | 'absent';

export interface Health {
  tone: Tone;
  reasons: string[];
}

const worse = (a: Tone, b: Tone): Tone =>
  a === 'absent' || b === 'absent' ? 'absent' : a === 'attention' || b === 'attention' ? 'attention' : 'ok';

export function entityHealth(index: GraphIndex, entity: Entity, today: IsoDate): Health {
  const reasons: string[] = [];
  let tone: Tone = 'ok';
  const note = (level: Tone, reason: string) => {
    tone = worse(tone, level);
    reasons.push(reason);
  };

  switch (entity.kind) {
    case 'requirement': {
      const controls = controlsFor(index, entity.requirementId);
      if (!controls.length) note('absent', 'no implementing control');
      else {
        const uncovered = entity.applicability.filter(
          (cls) => !controls.some((c) => c.coversIdentityClasses.includes(cls)),
        );
        if (uncovered.length) note('attention', `${uncovered.join(', ')} uncovered`);
        const stale = controls.flatMap((c) => evidenceFor(index, c.id)).filter((e) => isEvidenceStale(e, today));
        if (stale.length) note('attention', `${stale.length} stale evidence item(s)`);
      }
      break;
    }
    case 'control': {
      if (entity.implementationStatus === 'not_implemented') note('absent', 'not implemented');
      else if (entity.implementationStatus === 'planned') note('absent', 'planned only');
      else if (entity.implementationStatus === 'partially_implemented') note('attention', 'partially implemented');
      if (!testsFor(index, entity.id).length) note('attention', 'no test verifies it');
      const evidence = evidenceFor(index, entity.id);
      if (!evidence.length) note('attention', 'no evidence attached');
      else if (evidence.every((e) => isEvidenceStale(e, today))) note('attention', 'all evidence stale');
      const carveOuts = edgesTo(index, entity.id, 'excepts').length;
      if (carveOuts) reasons.push(`${carveOuts} exception(s) carve into it`);
      break;
    }
    case 'work_item': {
      if (!(index.outgoing.get(entity.id) ?? []).some((e) => e.type === 'fulfills')) {
        note('absent', 'fulfills no control');
      }
      if (entity.status === 'done' && !evidenceFor(index, entity.id).length) {
        note('attention', 'done, no evidence filed');
      }
      if (entity.status === 'blocked') note('attention', 'blocked');
      if (entity.staleReason) note('attention', entity.staleReason);
      break;
    }
    case 'test': {
      if (entity.lastResult === 'fail') note('absent', 'failing');
      else if (entity.lastResult === 'not_run' || !entity.lastRun) note('attention', 'never run');
      break;
    }
    case 'evidence': {
      if (isEvidenceStale(entity, today)) {
        const age = ageInDays(entity.lastVerified, today);
        note(
          age > entity.freshnessWindowDays * 1.25 ? 'absent' : 'attention',
          `${age}d old, window ${entity.freshnessWindowDays}d`,
        );
      }
      break;
    }
    case 'exception': {
      if (entity.status === 'expired') note('absent', 'expired');
      else if (entity.status === 'requires_reapproval') note('absent', 'requires reapproval');
      else if (isExceptionExpiringSoon(entity, today)) {
        note('attention', `expires in ${daysBetween(today, entity.expiresAt)}d`);
      }
      break;
    }
    default:
      break;
  }

  return { tone, reasons };
}
