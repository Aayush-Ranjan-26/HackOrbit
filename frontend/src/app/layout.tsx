import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';
import Providers from '@/components/Providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'HackOrbit — every hackathon, one feed',
  description:
    'HackOrbit pulls hackathons from Devpost, Unstop, Devfolio, MLH and HackerEarth into one feed, with deadline tracking and matches based on what you build.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <a href="#main" className="srOnly">Skip to content</a>
        <Providers>
          <Nav />
          <main id="main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
