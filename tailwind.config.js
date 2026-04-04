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
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
