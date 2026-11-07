const v = n => `rgb(var(--s-${n}) / <alpha-value>)`;
module.exports = {
  darkMode: 'class',
  content: ['./index.html'],
  theme: { extend: {
    fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
    colors: {
      white: 'rgb(var(--c-white) / <alpha-value>)',
      slate: { 50: v(50), 100: v(100), 200: v(200), 300: v(300), 400: v(400), 500: v(500), 600: v(600), 700: v(700), 800: v(800), 850: v(850), 900: v(900), 925: v(925), 950: v(950) }
    }
  } }
};
