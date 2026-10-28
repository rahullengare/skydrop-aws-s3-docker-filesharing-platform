// Tailwind CDN theme (load AFTER the Tailwind script tag).
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        // Calibri when installed (Windows / Office), otherwise Carlito/Lato look-alikes.
        sans: ['Calibri', 'Carlito', 'Lato', 'Segoe UI', 'system-ui', 'sans-serif']
      },
      colors: {
        navy: { DEFAULT: '#0B1F3A', 800: '#10294A', 700: '#17345C' },
        ink: '#0F172A',
        brand: { DEFAULT: '#0284C7', dark: '#0369A1', soft: '#E0F2FE' },
        indigo2: '#4F46E5',
        secure: { DEFAULT: '#059669', dark: '#047857', soft: '#E3F6EE' },
        surface: '#F1F6FC',
        line: '#DCE6F2'
      }
    }
  }
};
