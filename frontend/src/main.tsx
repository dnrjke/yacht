import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initViewportSync } from './utils/viewportSync'
import { initSpectatorTuningGui } from './debug/spectatorTuning'

initViewportSync()
initSpectatorTuningGui()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
