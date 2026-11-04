// Names belong to the object, not to the visitor. Same mix, same name.
const THEMES = ['sparkle', 'warm', 'comfort', 'bond', 'deep', 'play'];
const THEME_OF = {
  STAR: 'sparkle', GLITTER: 'sparkle', SEQUIN: 'play',
  HEART: 'warm', PEACH: 'warm',
  PEARL: 'comfort', MINT: 'comfort',
  RIBBON: 'bond',
  AURORA: 'deep', LAVENDER: 'deep',
};
// Counted per pour or drop, so a pinch of 42 glitter weighs the same as a pour of stars.
const PER_USE = { STAR: 10, HEART: 10, RIBBON: 8, PEARL: 14, SEQUIN: 16, AURORA: 8, GLITTER: 84, PEACH: 2, MINT: 2, LAVENDER: 2 };

const NAMES = {
  sparkle: { solo: '반짝이는 추억의 말랑이', warm: '따스하게 빛나는 말랑이', comfort: '은은하게 빛나는 말랑이', bond: '반짝임이 이어진 말랑이', deep: '깊게 반짝이는 말랑이', play: '반짝반짝 들뜬 말랑이' },
  warm: { solo: '다정하게 스며든 말랑이', sparkle: '다정하게 반짝이는 말랑이', comfort: '포근하게 스며든 말랑이', bond: '다정하게 이어진 말랑이', deep: '깊고 다정한 말랑이', play: '다정하게 들뜬 말랑이' },
  comfort: { solo: '편안하게 머무는 말랑이', sparkle: '소소하게 빛나는 말랑이', warm: '포근한 온기의 말랑이', bond: '느슨하게 머무는 말랑이', deep: '잔잔하게 깊어진 말랑이', play: '편안하게 웃는 말랑이' },
  bond: { solo: '느슨하게 이어진 말랑이', sparkle: '느슨하게 반짝이는 말랑이', warm: '다정하게 이어진 말랑이', comfort: '잔잔하게 이어진 말랑이', deep: '깊게 이어진 말랑이', play: '장난스레 얽힌 말랑이' },
  deep: { solo: '새롭게 깊어진 말랑이', sparkle: '새롭게 빛나는 말랑이', warm: '깊게 스며든 말랑이', comfort: '고요하게 깊어진 말랑이', bond: '깊게 얽힌 말랑이', play: '낯설게 빛나는 말랑이' },
  play: { solo: '장난기 가득한 말랑이', sparkle: '장난스레 반짝이는 말랑이', warm: '다정한 장난의 말랑이', comfort: '편안한 웃음의 말랑이', bond: '장난스레 이어진 말랑이', deep: '깊은 웃음의 말랑이' },
};

export function makeName(summary) {
  const score = Object.fromEntries(THEMES.map((t) => [t, 0]));
  for (const [id, n] of Object.entries({ ...summary.parts, ...summary.pigments })) {
    score[THEME_OF[id]] += n / PER_USE[id];
  }
  const ranked = THEMES.filter((t) => score[t] > 0).sort((a, b) => score[b] - score[a] || THEMES.indexOf(a) - THEMES.indexOf(b));
  if (!ranked.length) return '투명한 말랑이';
  const [first, second] = ranked;
  if (!second || score[second] < score[first] * 0.4) return NAMES[first].solo;
  return NAMES[first][second];
}
