import Link from 'next/link';
import styles from './page.module.css';

const SOURCES = [
  { name: 'Devpost', color: '#60a5fa' },
  { name: 'Unstop', color: '#fbbf24' },
  { name: 'Devfolio', color: '#22d3ee' },
  { name: 'MLH', color: '#f87171' },
  { name: 'HackerEarth', color: '#c084fc' },
];

const FEATURES = [
  {
    title: 'One feed, five platforms',
    body: 'Devpost, Unstop, Devfolio, MLH and HackerEarth, refreshed on a schedule and de-duplicated into a single list you can actually filter.',
  },
  {
    title: 'Deadlines you will not miss',
    body: 'Save a hackathon and its registration, start, submission and end dates land on your calendar automatically.',
  },
  {
    title: 'Matched to what you build',
    body: 'Tell us which domains you build in once, and the feed surfaces the open hackathons that overlap them, soonest deadline first.',
  },
  {
    title: 'Saved → applied → submitted',
    body: 'Track where you are with every hackathon, so nothing sits half-finished in a browser tab.',
  },
];

export default function Home() {
  return (
    <>
      <section className={styles.hero}>
        <div className="container">
          <p className={styles.badge}>
            <span className={styles.dot} aria-hidden="true" />
            Five platforms, one feed
          </p>

          <h1 className={styles.title}>
            Every hackathon.<br />
            <span className={styles.titleAccent}>One place.</span>
          </h1>

          <p className={styles.lede}>
            Stop checking five sites for the same thing. HackOrbit collects open hackathons
            into a single feed, tracks every deadline on your calendar, and surfaces
            the ones that match what you actually build.
          </p>

          <div className={styles.ctas}>
            <Link href="/explore" className="btn btnPrimary">Explore hackathons</Link>
            <Link href="/onboarding" className="btn">Get matched picks</Link>
          </div>

          <ul className={styles.sources} aria-label="Sources">
            {SOURCES.map((s) => (
              <li key={s.name} style={{ borderColor: `${s.color}55`, color: s.color }}>
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.features}>
        <div className="container">
          <h2 className={styles.sectionTitle}>What it does</h2>
          <div className={styles.grid}>
            {FEATURES.map((f) => (
              <article key={f.title} className={`card ${styles.feature}`}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.closing}>
        <div className="container-narrow">
          <h2 className={styles.closingTitle}>Find your next one.</h2>
          <p className={styles.closingBody}>
            Browsing needs no account. Sign in when you want to save hackathons and track deadlines.
          </p>
          <Link href="/explore" className="btn btnPrimary">Start exploring</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className="container">
          <span className={styles.brand}>HackOrbit</span>
          <span className={styles.footNote}>
            Listings belong to their source platforms and link back to them.
          </span>
        </div>
      </footer>
    </>
  );
}
