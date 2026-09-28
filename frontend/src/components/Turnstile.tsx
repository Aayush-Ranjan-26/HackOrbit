'use client';
import { useImperativeHandle, useRef, type Ref } from 'react';
import Script from 'next/script';

/**
 * Cloudflare Turnstile, the CAPTCHA Supabase checks on email sign-in, sign-up,
 * password reset and resend-confirmation. Once CAPTCHA protection is switched
 * on in Supabase, every one of those calls must carry a token from this widget
 * or it is rejected. Google sign-in is not affected.
 *
 * Loaded straight from Cloudflare rather than through a wrapper package: it is
 * one script and three calls. Renders nothing when no site key is configured,
 * so local development without one still works — in which case Supabase's
 * CAPTCHA switch must also be off.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    }
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  /** A token is single-use: call this after every request that spent one. */
  reset: () => void;
};

type Props = {
  /** Must be stable (a state setter is ideal) — the widget keeps the first one. */
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
};

export function Turnstile({ onToken, ref }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      onToken(null);
    },
  }));

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <>
      <div ref={el} />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        // onReady, not onLoad: it also fires when this component re-mounts after
        // a navigation, which is exactly when the widget has to be drawn again.
        onReady={() => {
          if (!el.current || !window.turnstile) return;
          if (widgetId.current) window.turnstile.remove(widgetId.current);
          widgetId.current = window.turnstile.render(el.current, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token) => onToken(token),
            'expired-callback': () => onToken(null),
            'error-callback': () => onToken(null),
          });
        }}
      />
    </>
  );
}
