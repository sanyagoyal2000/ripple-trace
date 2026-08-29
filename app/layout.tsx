import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './systems.css';
import './record-detail.css';
import './agent-demo.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'RippleTrace — Policy-to-Execution Intelligence',
  description: 'See how one policy change ripples through Wexler Systems across controls, work, tests, evidence, exceptions, and decisions.',
  openGraph: { title: 'RippleTrace', description: 'See how one policy change ripples through the enterprise.', images: ['/og.png'] },
  twitter: { card: 'summary_large_image', title: 'RippleTrace', description: 'See how one policy change ripples through the enterprise.', images: ['/og.png'] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head><script src="/webmcp-local.js"></script></head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
