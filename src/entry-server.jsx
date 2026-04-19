import React from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import AppRoutes from './AppRoutes.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'

export function render(url) {
  const helmetContext = {}
  const html = renderToString(
    <React.StrictMode>
      <HelmetProvider context={helmetContext}>
        <StaticRouter location={url}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </StaticRouter>
      </HelmetProvider>
    </React.StrictMode>
  )
  const { helmet } = helmetContext
  return { html, helmet }
}

export { getAllPaths } from './routes.js'
