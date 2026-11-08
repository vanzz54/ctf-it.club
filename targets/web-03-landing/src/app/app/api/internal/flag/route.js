import { ImageResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  const flag = process.env.FLAG || 'ITCLUB{dummy_flag_local_test}';

  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 24,
          color: '#00ffaa',
          background: '#0f172a',
          width: '100%',
          height: '100%',
          display: 'flex',
          textAlign: 'center',
          alignItems: 'center',
          justifyContent: 'center',
          border: '4px solid #1e293b',
          padding: '40px',
        }}
      >
        {flag}
      </div>
    ),
    {
      width: 1200,
      height: 300,
    }
  );
}
