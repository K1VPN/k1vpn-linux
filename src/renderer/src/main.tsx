import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getCapabilities } from './platform/capabilities'

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
root.classList.toggle('with-titlebar', getCapabilities().customTitleBar)

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
