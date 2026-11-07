import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from '../src/pages/popup/PopupApp.jsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<Popup />);
