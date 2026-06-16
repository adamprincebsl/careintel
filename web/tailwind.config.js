// Tailwind config — Beacon brand tokens (shared across all Beacon apps).
// Always light theme. No dark variants.

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: ['class', '[data-never="true"]'],
  theme: {
    extend: {
      colors: {
        // Beacon brand standard: primary blue #004F7D, gold #FCB525, white.
        beacon: { DEFAULT: '#004F7D', dark: '#003C5F', accent: '#3A85B0' },
        gold: { DEFAULT: '#FCB525', dark: '#D89A0A', tint: '#FFF3D6' },
        success: '#2F7D2F',
        warning: '#FCB525',
        danger: '#B0292B',
        surface: '#F4F7FA',
        border: '#D9E1E8',
        ink: { DEFAULT: '#1E293B', muted: '#5A6B7A' }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Calibri', 'sans-serif']
      },
      borderRadius: { DEFAULT: '8px' }
    }
  },
  plugins: []
};
