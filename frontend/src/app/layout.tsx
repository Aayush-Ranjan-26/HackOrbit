import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'HackOrbit — every hackathon, one feed',
  description:
    'HackOrbit pulls hackathons from Devpost, Unstop, Devfolio, MLH and HackerEarth into one feed, with deadline tracking and matches based on what you build.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /*
      Extensions rewrite the document shell before React hydrates — dark-mode
      ones set color-scheme on <html>, password managers and blockers add
      data-* attributes to <body>. Both were observed here and neither is
      fixable from application code. suppressHydrationWarning applies only to
      the element it is on, so every child is still checked normally.
    */
    <html lang="en" suppressHydrationWarning>
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
