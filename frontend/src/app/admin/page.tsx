'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchAdminStats, fetchScrapeStatus, triggerScrape, type AdminStats, type ScrapeLog } from '@/lib/api';
import { sourceColor, sourceLabel } from '@/lib/format';
import styles from './admin.module.css';

/**
 * Operator view. The admin secret lives on the server (see /api/admin proxy);
 * this page never holds it. A 503 here means ADMIN_SECRET_KEY is unset.
 */
export default function AdminPage() {
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [triggering, setTriggering] = useState(false);

  const load = useCallback(async () => {
    try {
      const [status, statsRes] = await Promise.all([fetchScrapeStatus(), fetchAdminStats()]);
      setLogs(status.logs);
      setRunning(status.running);
      setStats(statsRes);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Only poll while a scrape is in flight — a 10s poll forever was needless load.
    if (!running) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load, running]);

  const trigger = async () => {
    setTriggering(true);
    setError('');
    try {
      await triggerScrape();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger scrape');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className={styles.head}>
          <div>
            <h1 className="pageTitle">Admin</h1>
            <p className="pageSub">Scraper runs and source health.</p>
          </div>
          <button className="btn btnPrimary" onClick={trigger} disabled={triggering || running}>
            {running ? 'Scrape running…' : triggering ? 'Starting…' : 'Run full scrape'}
          </button>
        </div>

        {error && <div className="errorBox" style={{ marginBottom: '2rem' }}>{error}</div>}

        <div className={styles.stats}>
          <div className={`card ${styles.stat}`}>
            <span className={styles.statLabel}>Active hackathons</span>
            <span className={styles.statValue}>{stats?.total ?? '—'}</span>
          </div>
          {Object.entries(stats?.by_source ?? {}).map(([source, count]) => (
            <div
              key={source}
              className={`card ${styles.stat}`}
              style={{ borderBottom: `3px solid ${sourceColor(source)}` }}
            >
              <span className={styles.statLabel}>{sourceLabel(source)}</span>
              <span className={styles.statValue}>{count}</span>
            </div>
          ))}
        </div>

        <h2 className={styles.sectionTitle}>Recent runs</h2>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : (
          <div className={`card ${styles.tableWrap}`}>
            <table className={styles.table}>
              <caption className="srOnly">Recent scraper runs by source</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Records</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ color: sourceColor(log.source), fontWeight: 700 }}>
                      {sourceLabel(log.source)}
                    </td>
                    <td>
                      <span className={`${styles.status} ${styles[log.status]}`}>{log.status}</span>
                    </td>
                    <td>{new Date(log.started_at).toLocaleString()}</td>
                    <td>{log.records_upserted}</td>
                    <td className={styles.errorCell}>{log.error_message || '—'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className={styles.empty}>No runs recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
