import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/balsamiq-sans/400.css';
import '@fontsource/balsamiq-sans/700.css';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
