/** Colours resolve to the CSS tokens in styles.css so light and dark themes both work. */
const v = (n) => `var(--${n})`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), sunk: v('sunk'), ink: v('ink'), muted: v('muted'), line: v('line'),
        stamp: v('stamp'), 'stamp-soft': v('stamp-soft'), ok: v('ok'), 'ok-soft': v('ok-soft'), warn: v('warn'), 'warn-soft': v('warn-soft'), crit: v('crit'), 'crit-soft': v('crit-soft'),
      },
      fontFamily: { display: v('f-display'), body: v('f-body'), mono: v('f-mono'), report: v('f-report') },
    },
  },
  plugins: [],
};
