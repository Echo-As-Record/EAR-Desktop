import { createRoot } from 'react-dom/client'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing renderer root')

createRoot(root).render(
  <main>
    <h1>EAR Desktop</h1>
    <p role="status">云端 EAR 尚未连接</p>
    <p>连接功能实现后，你可以在这里查看手机录音的转写和总结。</p>
  </main>,
)
