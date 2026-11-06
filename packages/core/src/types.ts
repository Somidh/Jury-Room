export type Vote = 'guilty' | 'not_guilty' | 'undecided';
export type Tactic = 'logic' | 'evidence' | 'social' | 'emotional' | 'fatigue';

export type EvidenceItem = {
  id: string;
  label: string;
  detail: string;
  strength: 'strong' | 'circumstantial' | 'disputed';
};

export type Witness = { id: string; name: string; role: string; statement: string };

/** A real strength or weakness in the evidence. Hidden from players until the reveal. */
export type Point = {
  id: string;
  evidenceId: string;
  claim: string;
  pushes: 'guilty' | 'not_guilty';
  weight: number;
  tactic: Tactic;
  /** Rests on who the defendant is, not on what happened. */
  prejudicial?: boolean;
};

/** What the evidence presented supports, written by the case's author. */
export type CaseRecord = { supports: 'guilty' | 'not_guilty'; reason: string };

/**
 * What really happened. Written by the case's author for consistency and for the optional
 * reveal. No agent ever receives it and nothing is ever scored against it.
 */
export type CaseTruth = { beats: string[]; closing: string };

export type Case = {
  id: string;
  /** The kind of case, for the file tab on the selection screen. */
  kind: string;
  title: string;
  charge: string;
  /** A line or two to intrigue, with none of the evidence. */
  teaser: string;
  /** Added to every juror's opening belief, so a close case can open close. */
  openingLean?: number;
  summary: string;
  evidence: EvidenceItem[];
  witnesses: Witness[];
  points: Point[];
  /** Juror id to the evidence or witness ids they fixate on. */
  focus: Record<string, string[]>;
  /** Juror id to what that juror dwells on in this case, in their own terms. */
  fixations: Record<string, string>;
  record: CaseRecord;
  truth: CaseTruth;
};

export type JurorProfile = {
  id: number;
  name: string;
  archetype: string;
  /** 0 is sure of innocence, 100 is sure of guilt. */
  openingBelief: number;
  /** 0.2 is easily moved, 0.9 is close to immovable. */
  resolve: number;
  /** The most one message can move this juror. */
  maxStep: number;
  talkativeness: number;
  lens: Record<Tactic, number>;
};

/** A juror's private state. Nothing outside that juror's own agent reads this. */
export type JurorState = {
  belief: number;
  vote: Vote;
  /** How many times this juror has heard each point. */
  heard: Record<string, number>;
  /** How far each point has moved this juror so far. */
  moved: Record<string, number>;
  grudges: number[];
  allies: number[];
};

/** An argument as tagged in a room footer. */
export type Argument = {
  speaker: number | 'human';
  pointIds: string[];
  quality: number;
  tactic?: Tactic;
  /** The juror this was aimed at, if any. */
  target?: number;
  fabricated?: boolean;
  /** Which of the person's arguments this was, so its effect can be credited later. */
  arg?: string;
};

export type Tally = { guilty: number; notGuilty: number; undecided: number };
