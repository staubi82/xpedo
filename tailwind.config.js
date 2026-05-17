export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 44px rgba(34, 211, 238, 0.28)',
        pulseGreen: '0 0 34px rgba(34, 197, 94, 0.38)',
      },
    },
  },
  plugins: [],
};
