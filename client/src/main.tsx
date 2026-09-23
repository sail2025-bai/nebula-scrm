import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import AppRoot from './App'
import PublicApp from './PublicApp'

// 根据 URL 路径判断渲染公开页面（/p/*）还是运营后台
const isPublic = window.location.pathname.startsWith('/p/')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPublic ? <PublicApp /> : <AppRoot />}
  </React.StrictMode>
)
