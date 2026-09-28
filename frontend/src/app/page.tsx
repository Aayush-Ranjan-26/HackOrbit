import Link from 'next/link';
import Orbit from '@/components/Orbit';
import styles from './page.module.css';

const FEATURES = [
  {
    title: 'One feed, five sources',
    body: 'Listings from Devpost, Unstop, Devfolio, MLH and HackerEarth, refreshed every hour and de-duplicated, with filters you can share as a link.',
  },
  {
    title: 'Deadlines on your calendar',
    body: 'Save a hackathon and its registration, start, submission and end dates land on your calendar, next to whether you have applied or submitted.',
  },
  {
    title: 'Picks matched to you',
    body: 'Choose the domains you build in once, and For you lists the open hackathons that overlap them, soonest deadline first.',
  },
];

export default function Home() {
  return (
    <>
      <section className={styles.hero}>
        <div className={`container ${styles.heroGrid}`}>
          <div className={styles.copy}>
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
          <Orbit />
        </div>
      </section>

      <section className={styles.features} aria-label="What HackOrbit does">
        <div className={`container ${styles.grid}`}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.feature}>
              <h2>{f.title}</h2>
              <p>{f.body}</p>
            </div>
          ))}
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
