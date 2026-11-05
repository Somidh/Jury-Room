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
};

export type Case = {
  id: string;
  title: string;
  charge: string;
  summary: string;
  evidence: EvidenceItem[];
  witnesses: Witness[];
  points: Point[];
  /** Juror id to the evidence or witness ids they fixate on. */
  focus: Record<string, string[]>;
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
};

export type Tally = { guilty: number; notGuilty: number; undecided: number };
