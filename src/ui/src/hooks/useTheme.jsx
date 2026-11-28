/**
 * JobFinder — tema light/dark (hook + provider).
 *
 * A preferência vive em localStorage (chave `jobfinder_theme`) e é aplicada
 * como atributo `data-theme` no <html> — o CSS (Tailwind v4 variant +
 * classes de componente) reage a esse atributo. Padrão visual do ProdMaker.
 *
 * Uso:
 *   const { theme, toggleTheme } = useTheme();
 *   theme === 'dark' | 'light'
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'jobfinder_theme';

/** Tema inicial: localStorage > preferência do SO > light. */
function initialTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage indisponível (modo privado): segue para o padrão */
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    // Atributo no <html>: é o que o CSS observa.
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* persistência é melhor esforço */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>');
  }
  return context;
}