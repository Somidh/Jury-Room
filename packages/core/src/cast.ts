import type { JurorProfile, Tactic } from './types';

const lens = (
  logic: number,
  evidence: number,
  social: number,
  emotional: number,
  fatigue: number,
): Record<Tactic, number> => ({ logic, evidence, social, emotional, fatigue });

export const CAST: JurorProfile[] = [
  { id: 1, name: 'Marian Cole', archetype: 'The Foreman', openingBelief: 56, resolve: 0.5, maxStep: 9, talkativeness: 0.6, lens: lens(1.2, 1.1, 0.5, 0.7, 0.3) },
  { id: 2, name: 'Theo Brandvold', archetype: 'The Meek Follower', openingBelief: 62, resolve: 0.2, maxStep: 8, talkativeness: 0.2, lens: lens(0.6, 0.6, 2.2, 1, 0.8) },
  { id: 3, name: 'Gus Rourke', archetype: 'The Angry Man', openingBelief: 90, resolve: 0.85, maxStep: 4, talkativeness: 1, lens: lens(0.3, 0.4, 0.9, 1.4, 0.2) },
  { id: 4, name: 'Lena Ashworth', archetype: 'The Cold Analyst', openingBelief: 72, resolve: 0.5, maxStep: 14, talkativeness: 0.6, lens: lens(1.5, 1.2, 0.2, 0.1, 0.1) },
  { id: 5, name: 'Dre Malloy', archetype: 'The Defensive One', openingBelief: 55, resolve: 0.45, maxStep: 10, talkativeness: 0.4, lens: lens(0.9, 1.3, 0.4, 1, 0.3) },
  { id: 6, name: 'Sam Whitlock', archetype: 'The Decent Average Joe', openingBelief: 66, resolve: 0.35, maxStep: 10, talkativeness: 0.5, lens: lens(1, 1.3, 0.7, 0.9, 0.5) },
  { id: 7, name: 'Nico Vance', archetype: 'The Impatient One', openingBelief: 68, resolve: 0.3, maxStep: 8, talkativeness: 0.7, lens: lens(0.5, 0.5, 1.6, 0.5, 2) },
  { id: 8, name: 'Ruth Okoye', archetype: 'The Holdout', openingBelief: 34, resolve: 0.8, maxStep: 5, talkativeness: 0.7, lens: lens(1.3, 1.1, 0.2, 0.6, 0.1) },
  { id: 9, name: 'Walter Imai', archetype: 'The Wise Elder', openingBelief: 55, resolve: 0.5, maxStep: 9, talkativeness: 0.2, lens: lens(0.8, 0.9, 0.4, 1.5, 0.2) },
  { id: 10, name: 'Clive Pruitt', archetype: 'The Biased One', openingBelief: 95, resolve: 0.9, maxStep: 3, talkativeness: 0.8, lens: lens(0.1, 0.1, 1.4, 0.2, 0.2) },
  { id: 11, name: 'Mirela Dragan', archetype: 'The Principled Immigrant', openingBelief: 57, resolve: 0.55, maxStep: 9, talkativeness: 0.4, lens: lens(1, 1.3, 0.3, 0.6, 0.1) },
];
