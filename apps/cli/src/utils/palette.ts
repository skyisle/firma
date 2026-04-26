import pc from 'picocolors';

// Semantic palette — sized to a single mental model:
//  good     = healthy / favorable (green)
//  neutral  = informational, no judgment (default fg, slightly dim)
//  caution  = elevated / worth watching (yellow → orange-ish in most terms)
//  alert    = stressed / concerning (red)
export type Tier = 'good' | 'neutral' | 'caution' | 'alert';

export const tierColor: Record<Tier, (s: string) => string> = {
  good:    pc.green,
  neutral: (s: string) => s,
  caution: pc.yellow,
  alert:   pc.red,
};

// Δ polarity — does "up" make this metric better or worse?
export type Polarity = 'up_good' | 'up_bad' | 'neutral';

// Color a delta number based on the metric's polarity.
export const deltaColor = (polarity: Polarity, delta: number): ((s: string) => string) => {
  if (polarity === 'neutral' || delta === 0) return pc.dim;
  const moveIsGood = polarity === 'up_good' ? delta > 0 : delta < 0;
  return moveIsGood ? pc.green : pc.yellow;
};
