import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

if (import.meta.env.DEV && window.location.hostname === '127.0.0.1') {
  const canonicalUrl = new URL(window.location.href)
  canonicalUrl.hostname = 'localhost'
  window.location.replace(canonicalUrl.href)
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}
