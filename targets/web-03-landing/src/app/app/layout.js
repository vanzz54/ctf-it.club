export const metadata = {
  title: 'CyberNusa Avatar Fetcher',
  description: 'Fetch your external avatar securely!',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #111;
            color: #fff;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
