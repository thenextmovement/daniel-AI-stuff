/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{ts,tsx}',
    './landing-new-v2.html',
    './anfrage.html',
    './safelist.html',
  ],
  theme: {
    extend: {
      colors: {
        dark: '#0A0A0A',
        light: '#F5F5F5',
        accent: '#fa31a2',
      },
      letterSpacing: {
        tightest: '-0.06em',
      },
    },
  },
  plugins: [],
}
