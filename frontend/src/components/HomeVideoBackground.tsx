import styles from './HomeVideoBackground.module.css';

export default function HomeVideoBackground() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <video
        className={styles.video}
        aria-hidden="true"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/home-orbit-poster.webp"
      >
        <source media="(prefers-reduced-motion: no-preference)" src="/home-orbit.mp4" type="video/mp4" />
      </video>
      <div className={styles.overlay} />
    </div>
  );
}
