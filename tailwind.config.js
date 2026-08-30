/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        os: {
          ready: "#3B82F6",      // Azul - Listo
          running: "#10B981",    // Verde - Ejecución
          blocked: "#F59E0B",    // Naranja/Amarillo - Bloqueado
          terminated: "#6B7280", // Gris - Terminado
          dark: "#0F172A",
          card: "#1E293B",
          border: "#334155"
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
      }
    },
  },
  plugins: [],
}
