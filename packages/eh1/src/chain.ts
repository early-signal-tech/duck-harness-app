// EH-1 in a chain (the rack): DH-1 upstream, and the cable's AUTO-GRADE switch. When it's
// on, EH-1 asks its engine to follow (grade setlist runs as they finish, with this face's
// judge settings) and reports what's happened so the cable can show it. The grading
// itself is the engine's (eh1_grader/follow.py), so `eh1-grade --follow` does the same.

import type { FollowEvent } from "./engine";

/** What the host passes in when EH-1 sits in a chain. */
export interface ChainControl {
  /** AUTO-GRADE on the cable. */
  autoGrade: boolean;
  /** Following's progress this session, for the cable. */
  onFollow?: (status: FollowStatus) => void;
}

export interface FollowStatus {
  /** Following now (AUTO-GRADE on and the engine ready). */
  active: boolean;
  /** Runs graded by following this session, and what the judge cost. */
  graded: number;
  judgeCost: number;
  /** The setlist graded last. */
  lastSetlist: string | null;
  /** The latest thing that couldn't be graded: a setlist without its set, or a run that failed. */
  problem: string | null;
}

export const IDLE: FollowStatus = { active: false, graded: 0, judgeCost: 0, lastSetlist: null, problem: null };

/** The status after one follow event. Totals add up across follows (a settings change
 *  starts a new one), so they cover the session. */
export function onFollowEvent(status: FollowStatus, event: FollowEvent): FollowStatus {
  switch (event.event) {
    case "follow_start":
      return { ...status, active: true };
    case "graded":
      return {
        ...status,
        graded: status.graded + 1,
        judgeCost: status.judgeCost + (event.judge_cost_usd ?? 0),
        lastSetlist: event.setlist_run,
      };
    case "grade_error":
      return { ...status, problem: event.error };
    case "follow_skipped":
      return { ...status, problem: `Not graded: ${event.reason}.` };
  }
}
