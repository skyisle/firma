const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export const fracBar = (ratio: number, width: number): string => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = clamped * width;
  const full = Math.floor(filled);
  const partial = EIGHTHS[Math.round((filled - full) * 8)] ?? '';
  return '█'.repeat(full) + partial;
};
