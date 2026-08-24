/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        bitcoin: {
          50: '#fff8eb',
          100: '#ffecc6',
          200: '#ffd688',
          300: '#ffba4a',
          400: '#ffa520',
          500: '#f7931a', // Bitcoin orange
          600: '#db6e06',
          700: '#b64d09',
          800: '#943b0e',
          900: '#7a310f',
          950: '#461803',
        },
        sovereign: {
          50: '#f0f4ff',
          100: '#dde5ff',
          200: '#c2d0ff',
          300: '#97b1ff',
          400: '#6585ff',
          500: '#3b57ff',
          600: '#1e30f5',
          700: '#1621e1',
          800: '#181db6',
          900: '#1a1f8f',
          950: '#131457',
        },
        // CR-G: purple/gold royal theme carried per R6 verdict (CARRY REVISED)
        royal: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7', // primary purple
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
          950: '#3b0764',
        },
        gold: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24', // accent gold
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
