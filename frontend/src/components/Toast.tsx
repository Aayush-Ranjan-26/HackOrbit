'use client';
import { useCallback, useEffect, useState } from 'react';
import styles from './Toast.module.css';

type ToastKind = 'success' | 'error' | 'info';
type ToastState = { msg: string; kind: ToastKind } | null;

/** One toast, announced to screen readers. Replaces three near-identical copies. */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string, kind: ToastKind = 'success') => {
    setToast({ msg, kind });
  }, []);

  // aria-live region is always mounted; screen readers only announce changes to
  // a region that already exists, so rendering it on demand announces nothing.
  const toastElement = (
    <div className={styles.region} role="status" aria-live="polite">
      {toast && (
        <div className={`${styles.toast} ${styles[toast.kind]}`}>
          <span aria-hidden="true">
            {toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '✕' : 'ℹ'}
          </span>
          {toast.msg}
        </div>
      )}
    </div>
  );

  return { showToast, toastElement };
}
