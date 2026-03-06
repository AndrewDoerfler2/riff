import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import './index.css';
import App from './App.tsx';

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'Avenir Next, Inter, Segoe UI, sans-serif',
  headings: {
    fontFamily: 'Avenir Next, Inter, Segoe UI, sans-serif',
  },
  colors: {
    slate: [
      '#f3f5f7',
      '#e6e9ee',
      '#cfd5dd',
      '#b1bbc8',
      '#8d99aa',
      '#6f7c90',
      '#586477',
      '#475062',
      '#2f3644',
      '#1d2129',
    ],
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  </StrictMode>,
);
