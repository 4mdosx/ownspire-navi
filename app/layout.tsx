import type { Viewport } from 'next'
import localFont from 'next/font/local'
import OverlayScrollbars from '@/components/overlay-scrollbar'
import './globals.css'

const inter = localFont({
  src: '../public/fonts/Inter-Variable.ttf',
  display: 'swap',
})

export const metadata = {
  title: 'Ownspire Navi',
  description: 'Personal todo workspace for agents and humans.',
  appleWebApp: {
    capable: true,
    title: 'Ownspire Navi',
    statusBarStyle: 'default' as const,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
}

const themeInitScript = `(function(){try{var t=localStorage.getItem('ownspire-navi-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={inter.className}>
        {children}
        <OverlayScrollbars />
      </body>
    </html>
  )
}
