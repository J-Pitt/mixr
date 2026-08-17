import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerWebApp } from './lib/webApp';
import './styles.css';

registerWebApp();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);