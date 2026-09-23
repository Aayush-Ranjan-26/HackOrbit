'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useUser } from '@/lib/hooks';
import styles from './Nav.module.css';

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/saved', label: 'Saved' },
  { href: '/for-you', label: 'For you' },
];

/** The single nav for every page — previously re-implemented inline in five. */
export default function Nav() {
  const pathname = usePathname();
  const { user, loading, signOut, configured } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <nav className={styles.inner} aria-label="Main">
        <Link href="/" className={styles.brand}>
          <span aria-hidden="true">⬡</span> HackOrbit
        </Link>

        <button
          className={styles.burger}
          aria-expanded={menuOpen}
          aria-controls="nav-links"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>

        <div id="nav-links" className={`${styles.links} ${menuOpen ? styles.open : ''}`}>
          {LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={active ? styles.linkActive : styles.link}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </Link>
            );
          })}

          {/* Signed-in state was invisible everywhere and there was no way out. */}
          {!loading && configured && (
            user ? (
              <span className={styles.account}>
                <Link href="/account" className={styles.email} title={`Signed in as ${user.email}`}>
                  {user.email}
                </Link>
                <button className={styles.signOut} onClick={() => signOut()}>Sign out</button>
              </span>
            ) : (
              <Link href="/login" className={styles.signIn}>Sign in</Link>
            )
          )}
        </div>
      </nav>
    </header>
  );
}
