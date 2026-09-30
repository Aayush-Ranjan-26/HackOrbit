import Link from 'next/link';
import HomeVideoBackground from '@/components/HomeVideoBackground';
import styles from './page.module.css';

const SOURCES = ['Devpost', 'Unstop', 'Devfolio', 'MLH', 'HackerEarth'];

export default function Home() {
  return (
    <>
      <HomeVideoBackground />
      <section className={styles.hero}>
        <div className={`container ${styles.heroContent}`}>
          <div className={styles.copy}>
            <p className={styles.status}><span aria-hidden="true" /> Live orbital sync active</p>
            <h1 className={styles.title}>Every open hackathon, closest deadline first.</h1>
            <p className={styles.lede}>
              HackOrbit collects hackathons from Devpost, Unstop, Devfolio, MLH and HackerEarth into
              one feed. Save the ones you want, keep their deadlines on a calendar, and see picks
              matched to what you build.
            </p>
            <div className={styles.ctas}>
              <Link href="/explore" className="btn btnPrimary">Browse hackathons</Link>
              <Link href="/login" className="btn">Sign in</Link>
            </div>
          </div>

          <aside className={styles.orbitPanel} aria-label="Hackathon sources">
            <p className={styles.panelEyebrow}>One orbit, five sources</p>
            <p className={styles.panelCopy}>
              Open opportunities stay in one focused feed, ordered around the deadline that matters next.
            </p>
            <ul className={styles.sourceList}>
              {SOURCES.map((source) => <li key={source}>{source}</li>)}
            </ul>
          </aside>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className="container">
          <span className={styles.brand}>HackOrbit</span>
          <span className={styles.footNote}>Listings belong to their source platforms and link back to them.</span>
        </div>
      </footer>
    </>
  );
}
