import type { Metadata } from 'next';
import { Noto_Sans } from 'next/font/google';
import './globals.css';
import { AppQueryProvider } from './providers';

const notoSans = Noto_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CureNear Provider Onboarding',
  description: 'Internal portal for onboarding and verifying healthcare service providers.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={notoSans.variable}>
      <body className="min-h-screen font-sans">
        <AppQueryProvider>{children}</AppQueryProvider>
      </body>
    </html>
  );
}
