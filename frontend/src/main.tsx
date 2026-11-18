import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
// The display face for titles and numbers; the files load only when a page uses it.
import '@fontsource-variable/archivo/wdth.css';
import App from './App';
import './index.css';
import './styles/controls.css';
import './styles/workspace.css';
import './styles/look.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
