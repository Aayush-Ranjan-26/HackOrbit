'use client';
import { LibraryProvider, useLibraryState } from '@/lib/hooks';

/**
 * Holds saved + calendar state once for the whole app. Mounted in the root
 * layout so navigating between pages reuses the data instead of refetching it.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <LibraryProvider value={useLibraryState()}>{children}</LibraryProvider>;
}
