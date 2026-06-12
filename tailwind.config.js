/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-primary': '#0284c7',
        'brand-secondary': '#475569',
        'brand-bg-dark': '#0f172a',
        'brand-bg-light': '#1e293b',
        'brand-bg-lighter': '#334155',
      },
    },
  },
  plugins: [],
};
