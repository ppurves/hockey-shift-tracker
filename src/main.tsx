import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/global.css';
import './ui/capture.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// iOS only applies :active press styles when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });
