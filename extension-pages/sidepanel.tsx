import React from 'react';
import { createRoot } from 'react-dom/client';
import Sidepanel from '../src/pages/sidepanel/SidepanelApp.jsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<Sidepanel />);
