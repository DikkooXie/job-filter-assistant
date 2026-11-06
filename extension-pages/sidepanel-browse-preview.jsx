import '../dev/browse-preview-chrome.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import Sidepanel from '../src/pages/sidepanel/SidepanelApp.jsx';
import './styles.css';

const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')).render(<Sidepanel />);
