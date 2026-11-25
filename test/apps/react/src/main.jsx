import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// the smoke page, or every chart (?all): each imports its own kit, so a page loads only the blocks it draws with
const page = new URLSearchParams(location.search).has('all') ? import('./All.jsx') : import('./Smoke.jsx');
page.then(({ default: Page }) =>
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  ),
);
