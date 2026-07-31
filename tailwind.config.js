/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Noto Sans Hebrew has real niqqud positioning. Never Heebo/Assistant.
        hebrew: ['"Noto Sans Hebrew"', 'system-ui', 'sans-serif'],
        display: ['"Frank Ruhl Libre"', '"Noto Sans Hebrew"', 'serif'],
      },
      colors: {
        ink: {
          950: '#08070d',
          900: '#0f0d18',
          850: '#161327',
          800: '#1d1930',
          700: '#2a2545',
          600: '#3b3460',
        },
        glow: {
          DEFAULT: '#a78bfa',
          soft: '#c4b5fd',
          deep: '#7c3aed',
        },
        danger: '#f87171',
        safe: '#4ade80',
        gold: '#fbbf24',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-from-end': {
          '0%': { opacity: '0', transform: 'translateX(-28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(167,139,250,0.45)' },
          '70%': { boxShadow: '0 0 0 22px rgba(167,139,250,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(167,139,250,0)' },
        },
        'drift': {
          '0%,100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0,-10px,0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 260ms ease-out both',
        'rise-in': 'rise-in 320ms cubic-bezier(0.22,1,0.36,1) both',
        // RTL: content enters from the start edge (right) — negative X in an
        // rtl document points toward the right side of the screen.
        'slide-from-end': 'slide-from-end 300ms cubic-bezier(0.22,1,0.36,1) both',
        'pulse-ring': 'pulse-ring 2.2s ease-out infinite',
        'drift': 'drift 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
