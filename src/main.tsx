import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PostHogProvider } from 'posthog-js/react'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.tsx'
import { isPostHogEnabled, posthogApiKey, posthogOptions } from '@/lib/posthog'

const tree = (
  <BrowserRouter>
    <App />
    <Toaster position="top-center" richColors />
  </BrowserRouter>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPostHogEnabled ? (
      <PostHogProvider apiKey={posthogApiKey} options={posthogOptions}>
        {tree}
      </PostHogProvider>
    ) : (
      tree
    )}
  </StrictMode>,
)
