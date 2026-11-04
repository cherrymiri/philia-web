// Everything a designer may want to tune lives here.
export const INGREDIENTS = [
  { id: 'PEACH', kind: 'pigment', name: '피치핑크', meaning: '따뜻하고 다정한 우정', tags: ['warm', 'tender'] },
  { id: 'MINT', kind: 'pigment', name: '민트블루', meaning: '자유롭고 편안한 우정', tags: ['free', 'easygoing'] },
  { id: 'LAVENDER', kind: 'pigment', name: '라벤더', meaning: '깊고 진솔한 우정', tags: ['deep', 'sincere'] },
  { id: 'STAR', kind: 'part', name: '별', meaning: '특별한 추억', tags: ['special_memory'] },
  { id: 'HEART', kind: 'part', name: '하트', meaning: '고마움과 감동', tags: ['gratitude', 'moved'] },
  { id: 'RIBBON', kind: 'part', name: '리본 매듭', meaning: '느슨했던 관계', tags: ['loose_bond'] },
  { id: 'PEARL', kind: 'part', name: '미니 진주 비즈', meaning: '편안함과 익숙함', tags: ['comfort', 'familiarity'] },
  { id: 'SEQUIN', kind: 'part', name: '홀로그램 스팽글', meaning: '장난과 웃음', tags: ['playfulness', 'laughter'] },
  { id: 'AURORA', kind: 'part', name: '오로라 플레이크', meaning: '함께한 새로운 경험', tags: ['new_experience'] },
  { id: 'GLITTER', kind: 'part', name: '미세 반짝이', meaning: '소소한 일상', tags: ['everyday'] },
];

// Clones inside the gel only. Masters and the cup displays stay at real size.
export const PART = {
  STAR: { scale: 1.5, radius: 0.0027, perPour: 10, restTilt: 46 },
  HEART: { scale: 1.5, radius: 0.0027, perPour: 10, restTilt: 46 },
  RIBBON: { scale: 1.6, radius: 0.0037, perPour: 8, restTilt: -46, upright: true },
  PEARL: { scale: 1.3, radius: 0.0017, perPour: 14, restTilt: 0 },
  SEQUIN: { scale: 1.4, radius: 0.0025, perPour: 16, restTilt: 38 },
  AURORA: { scale: 1.0, radius: 0.0034, perPour: 8, restTilt: 34 },
  GLITTER: { scale: 5, radius: 0.0007, perPour: 84, spread: 0.009, restTilt: 0 },
};

export const MAX_VISIBLE = { default: 420, GLITTER: 3000 }; // display only; the record keeps everything

// Vivid so one drop reads inside the gel. Bottle liquid keeps its GLB colour.
export const PIGMENT = {
  PEACH: { color: '#ff6f8c', label: 'peach' },
  MINT: { color: '#2fd6c6', label: 'mint' },
  LAVENDER: { color: '#a56df5', label: 'lavender' },
};
export const BLOB = { radius: 0.0068, flat: 0.5 };

export const POUR = { tilt: 0.66, rimHeight: 0.066, gravity: 0.8, sink: 0.55 };
// azimuth: degrees around the gel, negative = camera moves to the serum side.
export const CAMERA = {
  wide: { fov: 16, elevation: 31, azimuth: -6, target: [0.003, 0.018, -0.04], halfW: 0.242, halfH: 0.128 },
  portrait: { fov: 20, elevation: 54, azimuth: 0, target: [0, 0.012, 0.082], halfW: 0.125, halfH: 0.25 },
  mix: { fov: 18, elevation: 50, azimuth: 0, target: [0, 0.008, 0.002], halfW: 0.13, halfH: 0.082 },
  mixPortrait: { fov: 18, elevation: 54, azimuth: 0, target: [0, 0.008, 0.002], halfW: 0.074, halfH: 0.13 },
  ending: { fov: 18, elevation: 38, azimuth: 0, target: [0, 0.006, 0.022], halfW: 0.13, halfH: 0.088 },
  endingPortrait: { fov: 18, elevation: 38, azimuth: 0, target: [0, 0.006, 0.03], halfW: 0.075, halfH: 0.14 },
};
