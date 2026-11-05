// Who each juror looks like, drawn from their character sheets.

export type HairStyle =
  | 'set' | 'part' | 'balding' | 'pulled' | 'fade' | 'short' | 'slick' | 'crop' | 'thin' | 'comb' | 'long';

export type Outfit = 'blouse' | 'tie' | 'workshirt' | 'blazer' | 'uniform' | 'flannel' | 'suit' | 'cardigan' | 'vest' | 'scarf';

export type Face = {
  skin: string;
  hair: string;
  style: HairStyle;
  /** Half the head's width and height. */
  width: number;
  height: number;
  /** 0 is a narrow chin, 1 is a heavy jaw. */
  jaw: number;
  /** Degrees. Positive pulls the brows into a scowl, negative lifts them in worry. */
  browTilt: number;
  browWeight: number;
  eyeSize: number;
  /** How far the upper lids hang, from 0 to 1. */
  lid: number;
  noseWidth: number;
  noseLength: number;
  mouthWidth: number;
  /** Negative turns down, positive turns up. */
  mouthCurve: number;
  /** 0 is unlined, 1 is very old. */
  age: number;
  beard?: 'stubble' | 'mustache' | 'goatee';
  glasses?: 'wire' | 'square' | 'half' | 'round';
  earrings?: boolean;
  outfit: Outfit;
  cloth: string;
  accent: string;
};

export const FACES: Record<number, Face> = {
  // A retired vice-principal: set silver hair, level gaze, a brooch.
  1: { skin: '#c9a184', hair: '#a9a49b', style: 'set', width: 49, height: 62, jaw: 0.5, browTilt: 1, browWeight: 3, eyeSize: 1, lid: 0.25, noseWidth: 1, noseLength: 1, mouthWidth: 0.9, mouthCurve: -0.15, age: 0.6, earrings: true, outfit: 'blouse', cloth: '#25304a', accent: '#c9b27a' },
  // A nervous payroll clerk: thin face, wire glasses, brows always worried.
  2: { skin: '#dcb49a', hair: '#8a6b42', style: 'part', width: 43, height: 63, jaw: 0.35, browTilt: -9, browWeight: 2.4, eyeSize: 1.12, lid: 0.05, noseWidth: 0.9, noseLength: 1.05, mouthWidth: 0.72, mouthCurve: -0.3, age: 0.05, glasses: 'wire', outfit: 'tie', cloth: '#b8b3a4', accent: '#4a5a6a' },
  // A trucking boss: heavy jaw, receding hair, unshaven, furious.
  3: { skin: '#b9785c', hair: '#77726a', style: 'balding', width: 56, height: 62, jaw: 1, browTilt: 13, browWeight: 5, eyeSize: 0.86, lid: 0.3, noseWidth: 1.3, noseLength: 1.05, mouthWidth: 1.05, mouthCurve: -0.5, age: 0.75, beard: 'stubble', outfit: 'workshirt', cloth: '#3b3f35', accent: '#2a2c26' },
  // An actuary: hair pulled back, square frames, nothing wasted.
  4: { skin: '#d9b9a3', hair: '#241a14', style: 'pulled', width: 44, height: 64, jaw: 0.42, browTilt: 3, browWeight: 2.2, eyeSize: 0.94, lid: 0.18, noseWidth: 0.88, noseLength: 1, mouthWidth: 0.78, mouthCurve: -0.08, age: 0.28, glasses: 'square', outfit: 'blazer', cloth: '#26262a', accent: '#d9d5cc' },
  // A paramedic: close fade, short beard, still in the service jacket.
  5: { skin: '#6f4a33', hair: '#15100c', style: 'fade', width: 48, height: 60, jaw: 0.72, browTilt: 6, browWeight: 3.6, eyeSize: 0.98, lid: 0.2, noseWidth: 1.12, noseLength: 0.95, mouthWidth: 0.92, mouthCurve: -0.12, age: 0.12, beard: 'goatee', outfit: 'uniform', cloth: '#1f3329', accent: '#b8a35a' },
  // A refrigeration tech: tired, decent, a moustache and a work shirt.
  6: { skin: '#c99e7c', hair: '#4d3a28', style: 'short', width: 50, height: 60, jaw: 0.68, browTilt: -3, browWeight: 3.4, eyeSize: 0.95, lid: 0.32, noseWidth: 1.1, noseLength: 1, mouthWidth: 0.9, mouthCurve: -0.05, age: 0.4, beard: 'mustache', outfit: 'flannel', cloth: '#51342a', accent: '#2a1c16' },
  // A car salesman: slicked hair, open collar, half a smirk.
  7: { skin: '#c6966f', hair: '#1d1510', style: 'slick', width: 47, height: 61, jaw: 0.7, browTilt: 4, browWeight: 3, eyeSize: 0.96, lid: 0.22, noseWidth: 1, noseLength: 0.98, mouthWidth: 1, mouthCurve: 0.34, age: 0.2, outfit: 'suit', cloth: '#2c2f3a', accent: '#c9c2b4' },
  // A court stenographer: cropped grey hair, reading glasses, unmoved.
  8: { skin: '#4f3325', hair: '#8f8a82', style: 'crop', width: 47, height: 61, jaw: 0.55, browTilt: 2, browWeight: 2.8, eyeSize: 1, lid: 0.26, noseWidth: 1.1, noseLength: 0.96, mouthWidth: 0.9, mouthCurve: -0.1, age: 0.45, glasses: 'half', earrings: true, outfit: 'cardigan', cloth: '#3f2433', accent: '#1f141a' },
  // A tailor of eighty-one: white hair, deep lines, a waistcoat he cut himself.
  9: { skin: '#d2b08e', hair: '#d9d5cc', style: 'thin', width: 45, height: 62, jaw: 0.46, browTilt: -2, browWeight: 2.2, eyeSize: 0.84, lid: 0.48, noseWidth: 0.98, noseLength: 1.04, mouthWidth: 0.8, mouthCurve: 0.1, age: 1, glasses: 'round', outfit: 'vest', cloth: '#34302a', accent: '#6b1f1f' },
  // A landlord: florid, comb-over, a small mouth that has already decided.
  10: { skin: '#d6a38c', hair: '#8b7f6c', style: 'comb', width: 55, height: 62, jaw: 0.92, browTilt: 7, browWeight: 3, eyeSize: 0.78, lid: 0.34, noseWidth: 1.16, noseLength: 1, mouthWidth: 0.68, mouthCurve: -0.34, age: 0.68, outfit: 'tie', cloth: '#2a2a33', accent: '#5a1c24' },
  // A pharmacist: dark hair going grey, straight brows, a scarf worn carefully.
  11: { skin: '#d3ab8c', hair: '#2a1f1c', style: 'long', width: 45, height: 63, jaw: 0.5, browTilt: 0, browWeight: 3.6, eyeSize: 1.02, lid: 0.2, noseWidth: 1.02, noseLength: 1.06, mouthWidth: 0.86, mouthCurve: -0.12, age: 0.36, earrings: true, outfit: 'scarf', cloth: '#2f3b38', accent: '#7a5a33' },
};
