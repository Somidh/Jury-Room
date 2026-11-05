// A juror's face, built in layers so the head can really turn. Each layer slides by a
// different amount as yaw changes, which is what makes a flat drawing read as a head.
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import type { Face } from './faces';

type Props = {
  face: Face;
  /** Where the head points: -1 is the viewer's left, 0 is straight at you, 1 is the right. */
  yaw: number;
  /** Which side the lamp is on: -1 left, 1 right. */
  light: number;
  /** A slow, staggered turn, rather than a glance. */
  slow: boolean;
  delay: number;
  frozen: boolean;
  /** Blinking stops when the room is staring at you. */
  staring: boolean;
};

const CX = 120;
const CY = 128;

function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const blended = [1, 3, 5].map((at) =>
    Math.round(channel(a, at) * (1 - amount) + channel(b, at) * amount).toString(16).padStart(2, '0'),
  );
  return `#${blended.join('')}`;
}

function headPath(width: number, height: number, jaw: number): string {
  const chin = 14 + jaw * 26;
  const cheek = width * (0.78 + jaw * 0.2);
  return [
    `M ${CX - width} ${CY - 8}`,
    `C ${CX - width} ${CY - height * 1.28}, ${CX + width} ${CY - height * 1.28}, ${CX + width} ${CY - 8}`,
    `C ${CX + width} ${CY + height * 0.38}, ${CX + cheek} ${CY + height * 0.7}, ${CX + chin} ${CY + height * 0.96}`,
    `Q ${CX} ${CY + height * 1.08}, ${CX - chin} ${CY + height * 0.96}`,
    `C ${CX - cheek} ${CY + height * 0.7}, ${CX - width} ${CY + height * 0.38}, ${CX - width} ${CY - 8}`,
    'Z',
  ].join(' ');
}

function Hair({ face, part, id }: { face: Face; part: 'back' | 'front'; id: string }) {
  const { width: w, height: h, hair, style } = face;
  const top = CY - h * 1.02;
  const light = mix(hair, '#e8a33d', 0.28);
  const shape = (d: string) => <path d={d} fill={`url(#hair-${part}-${id})`} />;

  if (part === 'back') {
    if (style === 'long') return shape(`M ${CX - w - 7} ${CY - 20} C ${CX - w - 12} ${top - 20}, ${CX + w + 12} ${top - 20}, ${CX + w + 7} ${CY - 20} L ${CX + w + 12} ${CY + h + 20} L ${CX - w - 12} ${CY + h + 20} Z`);
    if (style === 'set') return shape(`M ${CX - w - 8} ${CY + 10} C ${CX - w - 18} ${top - 26}, ${CX + w + 18} ${top - 26}, ${CX + w + 8} ${CY + 10} L ${CX + w - 2} ${CY + 32} L ${CX - w + 2} ${CY + 32} Z`);
    if (style === 'pulled') return <circle cx={CX} cy={top - 8} r={15} fill={mix(hair, '#000000', 0.2)} />;
    return null;
  }

  switch (style) {
    case 'set':
      return shape(`M ${CX - w - 2} ${CY - 14} C ${CX - w - 4} ${top - 22}, ${CX + w + 4} ${top - 22}, ${CX + w + 2} ${CY - 14} C ${CX + w - 8} ${top + 22}, ${CX + 14} ${top + 12}, ${CX - 6} ${top + 22} C ${CX - 24} ${top + 28}, ${CX - w + 4} ${top + 30}, ${CX - w - 2} ${CY - 14} Z`);
    case 'part':
      return shape(`M ${CX - w} ${CY - 22} C ${CX - w - 2} ${top - 14}, ${CX + w + 2} ${top - 16}, ${CX + w} ${CY - 22} C ${CX + w - 6} ${top + 16}, ${CX - 2} ${top + 18}, ${CX - 22} ${top + 8} C ${CX - 30} ${top + 14}, ${CX - w + 2} ${top + 26}, ${CX - w} ${CY - 22} Z`);
    case 'balding':
      return (
        <>
          {shape(`M ${CX - w - 1} ${CY - 2} C ${CX - w - 3} ${top + 14}, ${CX - 26} ${top - 2}, ${CX - 18} ${top + 2} C ${CX - 34} ${top + 22}, ${CX - w + 6} ${top + 40}, ${CX - w + 3} ${CY - 2} Z`)}
          {shape(`M ${CX + w + 1} ${CY - 2} C ${CX + w + 3} ${top + 14}, ${CX + 26} ${top - 2}, ${CX + 18} ${top + 2} C ${CX + 34} ${top + 22}, ${CX + w - 6} ${top + 40}, ${CX + w - 3} ${CY - 2} Z`)}
        </>
      );
    case 'pulled':
      return shape(`M ${CX - w} ${CY - 18} C ${CX - w - 1} ${top - 12}, ${CX + w + 1} ${top - 12}, ${CX + w} ${CY - 18} C ${CX + w - 12} ${top + 18}, ${CX + 8} ${top + 8}, ${CX} ${top + 8} C ${CX - 8} ${top + 8}, ${CX - w + 12} ${top + 18}, ${CX - w} ${CY - 18} Z`);
    case 'fade':
      return shape(`M ${CX - w} ${CY - 22} C ${CX - w} ${top - 8}, ${CX + w} ${top - 8}, ${CX + w} ${CY - 22} C ${CX + w - 6} ${top + 14}, ${CX + 20} ${top + 13}, ${CX} ${top + 13} C ${CX - 20} ${top + 13}, ${CX - w + 6} ${top + 14}, ${CX - w} ${CY - 22} Z`);
    case 'short':
      return shape(`M ${CX - w} ${CY - 24} C ${CX - w - 3} ${top - 14}, ${CX + w + 3} ${top - 14}, ${CX + w} ${CY - 24} C ${CX + w - 5} ${top + 18}, ${CX + 22} ${top + 12}, ${CX + 6} ${top + 16} C ${CX - 16} ${top + 20}, ${CX - w + 5} ${top + 20}, ${CX - w} ${CY - 24} Z`);
    case 'slick':
      return (
        <>
          {shape(`M ${CX - w} ${CY - 24} C ${CX - w - 2} ${top - 22}, ${CX + w + 2} ${top - 22}, ${CX + w} ${CY - 24} C ${CX + w - 8} ${top + 12}, ${CX + 12} ${top + 8}, ${CX - 8} ${top + 12} C ${CX - 26} ${top + 16}, ${CX - w + 5} ${top + 20}, ${CX - w} ${CY - 24} Z`)}
          <path d={`M ${CX - 22} ${top - 4} C ${CX} ${top - 12}, ${CX + 20} ${top - 8}, ${CX + w - 8} ${top + 10}`} stroke={light} strokeWidth={2} fill="none" opacity={0.55} />
        </>
      );
    case 'crop':
      return shape(`M ${CX - w - 1} ${CY - 12} C ${CX - w - 3} ${top - 20}, ${CX + w + 3} ${top - 20}, ${CX + w + 1} ${CY - 12} C ${CX + w - 3} ${top + 26}, ${CX + 24} ${top + 22}, ${CX} ${top + 22} C ${CX - 24} ${top + 22}, ${CX - w + 3} ${top + 26}, ${CX - w - 1} ${CY - 12} Z`);
    case 'thin':
      return (
        <>
          {shape(`M ${CX - w - 1} ${CY - 6} C ${CX - w - 2} ${top + 20}, ${CX - 24} ${top + 6}, ${CX - 10} ${top + 8} C ${CX - 28} ${top + 22}, ${CX - w + 5} ${top + 42}, ${CX - w + 3} ${CY - 6} Z`)}
          {shape(`M ${CX + w + 1} ${CY - 6} C ${CX + w + 2} ${top + 20}, ${CX + 24} ${top + 6}, ${CX + 10} ${top + 8} C ${CX + 28} ${top + 22}, ${CX + w - 5} ${top + 42}, ${CX + w - 3} ${CY - 6} Z`)}
        </>
      );
    case 'comb':
      return (
        <>
          {shape(`M ${CX - w - 1} ${CY - 6} C ${CX - w - 3} ${top + 6}, ${CX - 20} ${top - 4}, ${CX + 30} ${top + 4} C ${CX + 10} ${top + 10}, ${CX - w + 6} ${top + 34}, ${CX - w + 3} ${CY - 6} Z`)}
          {shape(`M ${CX + w + 1} ${CY - 2} C ${CX + w + 2} ${top + 26}, ${CX + w - 6} ${top + 22}, ${CX + w - 12} ${top + 22} C ${CX + w - 8} ${top + 40}, ${CX + w - 3} ${CY - 20}, ${CX + w - 3} ${CY - 2} Z`)}
        </>
      );
    case 'long':
      return shape(`M ${CX - w - 2} ${CY + 26} C ${CX - w - 6} ${top - 16}, ${CX + w + 6} ${top - 16}, ${CX + w + 2} ${CY + 26} C ${CX + w - 2} ${CY - 22}, ${CX + 20} ${top + 18}, ${CX} ${top + 8} C ${CX - 20} ${top + 18}, ${CX - w + 2} ${CY - 22}, ${CX - w - 2} ${CY + 26} Z`);
  }
}

function Body({ face, id }: { face: Face; id: string }) {
  const { outfit, cloth, accent, skin } = face;
  const shoulders = `M 8 320 C 12 262, 40 236, 92 224 L 148 224 C 200 236, 228 262, 232 320 Z`;
  const collarSkin = mix(skin, '#000000', 0.42);
  return (
    <>
      <path d={shoulders} fill={`url(#cloth-${id})`} />
      {(outfit === 'suit' || outfit === 'workshirt' || outfit === 'uniform' || outfit === 'flannel') && (
        <path d="M 96 222 L 120 270 L 144 222 Z" fill={outfit === 'suit' ? mix(accent, '#000000', 0.25) : collarSkin} />
      )}
      {(outfit === 'tie' || outfit === 'vest') && (
        <>
          <path d="M 94 222 L 120 262 L 146 222 Z" fill={outfit === 'vest' ? '#c9c2b4' : mix(cloth, '#ffffff', 0.12)} />
          <path d="M 113 232 L 127 232 L 131 290 L 120 312 L 109 290 Z" fill={accent} />
        </>
      )}
      {outfit === 'suit' && <path d="M 96 222 L 120 276 L 108 318 L 70 240 Z M 144 222 L 120 276 L 132 318 L 170 240 Z" fill={mix(cloth, '#000000', 0.3)} />}
      {outfit === 'blazer' && (
        <>
          <path d="M 100 224 L 120 268 L 140 224 Z" fill={accent} />
          <path d="M 100 224 L 120 268 L 112 320 L 74 244 Z M 140 224 L 120 268 L 128 320 L 166 244 Z" fill={mix(cloth, '#000000', 0.35)} />
        </>
      )}
      {outfit === 'blouse' && (
        <>
          <path d="M 98 224 Q 120 262 142 224" stroke={mix(cloth, '#ffffff', 0.25)} strokeWidth={5} fill="none" />
          <circle cx={120} cy={262} r={5} fill={accent} />
        </>
      )}
      {outfit === 'cardigan' && (
        <>
          <path d="M 100 224 Q 120 248 140 224 L 132 320 L 108 320 Z" fill={mix(cloth, '#000000', 0.45)} />
          <path d="M 108 250 L 106 320 M 132 250 L 134 320" stroke={accent} strokeWidth={3} />
        </>
      )}
      {outfit === 'scarf' && (
        <path d="M 88 222 C 100 244, 140 244, 152 222 C 156 240, 142 262, 128 262 L 136 300 L 116 300 L 112 262 C 98 262, 84 240, 88 222 Z" fill={accent} />
      )}
      {outfit === 'uniform' && (
        <>
          <path d="M 96 222 L 120 256 L 96 262 L 76 234 Z M 144 222 L 120 256 L 144 262 L 164 234 Z" fill={mix(cloth, '#000000', 0.35)} />
          <rect x={160} y={266} width={24} height={12} rx={1} fill={accent} opacity={0.7} />
        </>
      )}
      {outfit === 'flannel' && (
        <path d="M 40 260 L 200 260 M 30 288 L 210 288 M 76 240 L 70 320 M 164 240 L 170 320" stroke={accent} strokeWidth={3} opacity={0.55} />
      )}
      {outfit === 'workshirt' && <path d="M 96 222 L 120 258 L 92 262 L 74 236 Z M 144 222 L 120 258 L 148 262 L 166 236 Z" fill={mix(cloth, '#ffffff', 0.08)} />}
    </>
  );
}

function Glasses({ kind }: { kind: NonNullable<Face['glasses']> }) {
  const frame = kind === 'square' ? '#0e0c0b' : '#b89b62';
  const y = kind === 'half' ? 6 : 0;
  const lens = { fill: 'rgb(232 163 61 / 8%)', stroke: frame, strokeWidth: kind === 'wire' ? 1.3 : 2.1 };
  return (
    <g>
      {kind === 'square' ? (
        <>
          <rect x={CX - 36} y={CY - 19} width={30} height={20} rx={3} {...lens} />
          <rect x={CX + 6} y={CY - 19} width={30} height={20} rx={3} {...lens} />
        </>
      ) : kind === 'half' ? (
        <>
          <path d={`M ${CX - 35} ${CY - 6 + y} L ${CX - 7} ${CY - 6 + y} Q ${CX - 8} ${CY + 9 + y}, ${CX - 21} ${CY + 9 + y} Q ${CX - 34} ${CY + 9 + y}, ${CX - 35} ${CY - 6 + y} Z`} {...lens} />
          <path d={`M ${CX + 35} ${CY - 6 + y} L ${CX + 7} ${CY - 6 + y} Q ${CX + 8} ${CY + 9 + y}, ${CX + 21} ${CY + 9 + y} Q ${CX + 34} ${CY + 9 + y}, ${CX + 35} ${CY - 6 + y} Z`} {...lens} />
        </>
      ) : (
        <>
          <circle cx={CX - 21} cy={CY - 9} r={14} {...lens} />
          <circle cx={CX + 21} cy={CY - 9} r={14} {...lens} />
        </>
      )}
      <path d={`M ${CX - 7} ${CY - 9 + y} Q ${CX} ${CY - 13 + y}, ${CX + 7} ${CY - 9 + y}`} stroke={frame} strokeWidth={1.6} fill="none" />
    </g>
  );
}

export function Portrait({ face, yaw, light, slow, delay, frozen, staring }: Props) {
  const id = useId().replace(/:/g, '');
  const turn = useMotionValue(yaw);
  const [blink, setBlink] = useState(false);
  const still = useReducedMotion();

  useEffect(() => {
    if (still) {
      turn.set(yaw);
      return;
    }
    const control = animate(
      turn,
      yaw,
      slow ? { type: 'spring', stiffness: 16, damping: 9, delay } : { type: 'spring', stiffness: 70, damping: 15, delay: delay / 4 },
    );
    return () => control.stop();
  }, [turn, yaw, slow, delay, still]);

  useEffect(() => {
    if (frozen || staring) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        next();
      }, 2200 + Math.random() * 5200);
    };
    next();
    return () => clearTimeout(timer);
  }, [frozen, staring]);

  const skull = useTransform(turn, (v) => v * 5);
  const features = useTransform(turn, (v) => v * 17);
  const nose = useTransform(turn, (v) => v * 8);
  const ears = useTransform(turn, (v) => v * -7);
  const hairShift = useTransform(turn, (v) => v * 4);
  const pupils = useTransform(turn, (v) => (staring ? -v * 2 : v * 2.4));
  const squeeze = useTransform(turn, (v) => 1 - Math.abs(v) * 0.09);
  const neck = useTransform(turn, (v) => v * 2);

  const { skin, width: w, height: h, jaw, age, hair } = face;
  const warm = mix(skin, '#ffcf8a', 0.3);
  const shade = mix(skin, '#160a05', 0.62);
  const deep = mix(skin, '#0c0603', 0.8);
  const head = headPath(w, h, jaw);
  const eyeX = 21;
  const eyeY = CY - 9;
  const eyeR = 7.2 * face.eyeSize;
  const browY = eyeY - 13 - (face.browTilt < 0 ? 2 : 0);
  const mouthY = CY + h * 0.62;
  const mouthW = 20 * face.mouthWidth;
  const curve = face.mouthCurve * 11;
  const lid = face.lid;

  const eye = (side: -1 | 1) => {
    const x = CX + side * eyeX;
    return (
      <g key={side}>
        <ellipse cx={x} cy={eyeY + 1} rx={eyeR + 5} ry={eyeR + 3} fill={`url(#socket-${id})`} />
        <clipPath id={`eye-${id}-${side}`}>
          <path d={`M ${x - eyeR - 2} ${eyeY} Q ${x} ${eyeY - eyeR - 1}, ${x + eyeR + 2} ${eyeY} Q ${x} ${eyeY + eyeR * 0.8}, ${x - eyeR - 2} ${eyeY} Z`} />
        </clipPath>
        <g clipPath={`url(#eye-${id}-${side})`}>
          <rect x={x - 14} y={eyeY - 12} width={28} height={24} fill="#cfc4ad" />
          <motion.g style={{ x: pupils }}>
            <circle cx={x} cy={eyeY - 0.5} r={eyeR * 0.68} fill={mix(hair, '#2a1a10', 0.7)} />
            <circle cx={x} cy={eyeY - 0.5} r={eyeR * 0.36} fill="#060302" />
            <circle cx={x - 1.6} cy={eyeY - 2.6} r={1.1} fill="#ffe3b0" />
          </motion.g>
          <rect
            x={x - 14}
            y={eyeY - 12}
            width={28}
            height={blink ? 24 : 12 - eyeR * 0.72 + lid * eyeR * 1.1}
            fill={mix(skin, '#1a0d07', 0.34)}
          />
        </g>
        <path d={`M ${x - eyeR - 2} ${eyeY} Q ${x} ${eyeY - eyeR - 1 + lid * 3}, ${x + eyeR + 2} ${eyeY}`} stroke={deep} strokeWidth={1.7} fill="none" />
        {age > 0.3 && <path d={`M ${x - eyeR} ${eyeY + 6} Q ${x} ${eyeY + 9.5}, ${x + eyeR} ${eyeY + 6}`} stroke={deep} strokeWidth={0.9} opacity={0.3 + age * 0.45} fill="none" />}
        {age > 0.55 && <path d={`M ${x + side * (eyeR + 4)} ${eyeY - 1} l ${side * 6} -2 M ${x + side * (eyeR + 4)} ${eyeY + 3} l ${side * 6} 1`} stroke={deep} strokeWidth={0.9} opacity={0.55} />}
        <path
          d={`M ${x - 13} ${browY + (side === -1 ? -face.browTilt * 0.34 : face.browTilt * 0.34)} Q ${x} ${browY - 4}, ${x + 13} ${browY + (side === -1 ? face.browTilt * 0.34 : -face.browTilt * 0.34)}`}
          stroke={mix(hair, '#0d0805', 0.45)}
          strokeWidth={face.browWeight}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    );
  };

  return (
    <svg viewBox="0 0 240 320" className="portrait" aria-hidden="true">
      <defs>
        <radialGradient id={`skin-${id}`} cx={0.5 + light * 0.2} cy={0.26} r={0.86}>
          <stop offset="0" stopColor={warm} />
          <stop offset="0.5" stopColor={skin} />
          <stop offset="1" stopColor={shade} />
        </radialGradient>
        <linearGradient id={`side-${id}`} x1={light > 0 ? 1 : 0} x2={light > 0 ? 0 : 1} y1={0} y2={0}>
          <stop offset="0.42" stopColor="#0c0603" stopOpacity={0} />
          <stop offset="1" stopColor="#0c0603" stopOpacity={0.82} />
        </linearGradient>
        <radialGradient id={`socket-${id}`}>
          <stop offset="0.3" stopColor={deep} stopOpacity={0.62} />
          <stop offset="1" stopColor={deep} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`hair-front-${id}`} cx={0.5 + light * 0.18} cy={0.05} r={0.9}>
          <stop offset="0" stopColor={mix(hair, '#e8a33d', 0.3)} />
          <stop offset="0.6" stopColor={hair} />
          <stop offset="1" stopColor={mix(hair, '#000000', 0.55)} />
        </radialGradient>
        <linearGradient id={`hair-back-${id}`} x1={0} x2={0} y1={0} y2={1}>
          <stop offset="0" stopColor={hair} />
          <stop offset="1" stopColor={mix(hair, '#000000', 0.7)} />
        </linearGradient>
        <linearGradient id={`cloth-${id}`} x1={0} x2={0} y1={0} y2={1}>
          <stop offset="0" stopColor={mix(face.cloth, '#e8a33d', 0.12)} />
          <stop offset="0.6" stopColor={face.cloth} />
          <stop offset="1" stopColor="#0a0604" />
        </linearGradient>
        <linearGradient id={`neck-${id}`} x1={0} x2={0} y1={0} y2={1}>
          <stop offset="0" stopColor={deep} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <linearGradient id={`stubble-${id}`} x1={0} x2={0} y1={0} y2={1}>
          <stop offset="0" stopColor="#231a15" stopOpacity={0} />
          <stop offset="0.55" stopColor="#231a15" stopOpacity={0.42} />
        </linearGradient>
        <clipPath id={`head-${id}`}>
          <path d={head} />
        </clipPath>
      </defs>

      <g transform="translate(0 -24)"><Body face={face} id={id} /></g>
      <motion.path style={{ x: neck }} d={`M ${CX - 25} ${CY + h * 0.6} L ${CX - 31} 208 Q ${CX} 222 ${CX + 31} 208 L ${CX + 25} ${CY + h * 0.6} Z`} fill={`url(#neck-${id})`} />

      <motion.g style={{ x: skull, scaleX: squeeze, transformOrigin: `${CX}px ${CY}px` }}>
        <motion.g style={{ x: hairShift }}><Hair face={face} part="back" id={id} /></motion.g>
        <motion.g style={{ x: ears }}>
          <ellipse cx={CX - w - 2} cy={CY - 2} rx={7} ry={13} fill={mix(skin, '#160a05', 0.32)} />
          <ellipse cx={CX + w + 2} cy={CY - 2} rx={7} ry={13} fill={mix(skin, '#160a05', 0.32)} />
          {face.earrings && (
            <>
              <circle cx={CX - w - 3} cy={CY + 13} r={2.6} fill="#d8c48c" />
              <circle cx={CX + w + 3} cy={CY + 13} r={2.6} fill="#d8c48c" />
            </>
          )}
        </motion.g>

        <path d={head} fill={`url(#skin-${id})`} />
        <g clipPath={`url(#head-${id})`}>
          {face.beard === 'stubble' && <rect x={CX - w} y={CY + h * 0.2} width={w * 2} height={h} fill={`url(#stubble-${id})`} />}
          {jaw > 0.85 && <path d={`M ${CX - 34} ${CY + h * 0.92} Q ${CX} ${CY + h * 1.08}, ${CX + 34} ${CY + h * 0.92}`} stroke={deep} strokeWidth={1.4} opacity={0.5} fill="none" />}
          {age > 0.5 && (
            <path d={`M ${CX - 26} ${CY - h * 0.52} q 26 -5 52 0 M ${CX - 22} ${CY - h * 0.64} q 22 -4 44 0`} stroke={deep} strokeWidth={0.9} opacity={0.2 + age * 0.3} fill="none" />
          )}
          <ellipse cx={CX - w * 0.8} cy={CY + h * 0.46} rx={w * 0.5} ry={h * 0.42} fill={`url(#socket-${id})`} opacity={0.5} />
          <ellipse cx={CX + w * 0.8} cy={CY + h * 0.46} rx={w * 0.5} ry={h * 0.42} fill={`url(#socket-${id})`} opacity={0.5} />
          <rect x={0} y={0} width={240} height={320} fill={`url(#side-${id})`} />
        </g>

        <motion.g style={{ x: features }}>
          {eye(-1)}
          {eye(1)}
          <motion.g style={{ x: nose }}>
            <path
              d={`M ${CX - 2} ${eyeY + 2} C ${CX - 4} ${CY + 14}, ${CX - 13 * face.noseWidth} ${CY + 21 * face.noseLength}, ${CX - 11 * face.noseWidth} ${CY + 26 * face.noseLength} Q ${CX} ${CY + 33 * face.noseLength}, ${CX + 11 * face.noseWidth} ${CY + 26 * face.noseLength}`}
              stroke={deep}
              strokeWidth={1.2}
              opacity={0.5}
              fill="none"
            />
            <ellipse cx={CX - light * 5} cy={CY + 16 * face.noseLength} rx={5 * face.noseWidth} ry={12} fill={deep} opacity={0.13} />
            <ellipse cx={CX} cy={CY + 34 * face.noseLength} rx={14 * face.noseWidth} ry={3.4} fill={deep} opacity={0.4} />
          </motion.g>
          {age > 0.35 && (
            <path d={`M ${CX - 17 * face.noseWidth} ${CY + 26} Q ${CX - mouthW - 8} ${mouthY - 12}, ${CX - mouthW - 5} ${mouthY + 3} M ${CX + 17 * face.noseWidth} ${CY + 26} Q ${CX + mouthW + 8} ${mouthY - 12}, ${CX + mouthW + 5} ${mouthY + 3}`} stroke={deep} strokeWidth={1.1} opacity={0.2 + age * 0.45} fill="none" />
          )}
          {face.beard === 'mustache' && <path d={`M ${CX - mouthW - 2} ${mouthY - 1} Q ${CX} ${mouthY - 15}, ${CX + mouthW + 2} ${mouthY - 1} Q ${CX} ${mouthY - 7}, ${CX - mouthW - 2} ${mouthY - 1} Z`} fill={mix(hair, '#000000', 0.2)} />}
          {face.beard === 'goatee' && <path d={`M ${CX - 15} ${mouthY + 7} Q ${CX} ${mouthY + 3}, ${CX + 15} ${mouthY + 7} Q ${CX + 15} ${mouthY + 26}, ${CX} ${mouthY + 27} Q ${CX - 15} ${mouthY + 26}, ${CX - 15} ${mouthY + 7} Z M ${CX - mouthW - 1} ${mouthY - 7} Q ${CX} ${mouthY - 13}, ${CX + mouthW + 1} ${mouthY - 7} L ${CX + mouthW - 2} ${mouthY - 4} Q ${CX} ${mouthY - 9}, ${CX - mouthW + 2} ${mouthY - 4} Z`} fill={face.hair} opacity={0.9} />}
          <path d={`M ${CX - mouthW} ${mouthY - curve * 0.6 - (face.mouthCurve > 0.2 ? -2 : 0)} Q ${CX} ${mouthY + curve}, ${CX + mouthW} ${mouthY - curve * 0.6 - (face.mouthCurve > 0.2 ? 3 : 0)}`} stroke={mix(skin, '#2a0d0a', 0.76)} strokeWidth={2.3} strokeLinecap="round" fill="none" />
          <ellipse cx={CX} cy={mouthY + 8} rx={mouthW * 0.64} ry={2.6} fill={deep} opacity={0.3} />
          {face.glasses && <Glasses kind={face.glasses} />}
        </motion.g>

        <motion.g style={{ x: hairShift }}><Hair face={face} part="front" id={id} /></motion.g>
      </motion.g>
    </svg>
  );
}
