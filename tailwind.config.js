/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Paleta do simulador (CLAUDE.md, seção Design).
      colors: {
        bg: '#0B120E',
        card: '#121C16',
        line: '#223028',
        line2: '#35483C',
        text: '#EEF3EC',
        muted: '#9DB0A3',
        lime: '#C6F24E',
        ink: '#0B120E',
        warn: '#FF8A3D',
        unk: '#3A433E',
        ramp: { 1: '#1E3A2B', 2: '#2F6B4A', 3: '#5DB383' },
        proj: '#6FA8FF',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', '"Inter Variable"', 'sans-serif'],
      },
      screens: {
        // Mesmo corte do simulador: até 900 px é celular (navegação embaixo).
        desk: '901px',
      },
      borderRadius: {
        card: '20px',
      },
    },
  },
  plugins: [],
};
