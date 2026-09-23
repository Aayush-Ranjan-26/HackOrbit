'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/lib/hooks';
import { fetchProfile, updateProfile, type Profile } from '@/lib/api';
import { useToast } from '@/components/Toast';
import styles from './onboarding.module.css';

// Kept in sync with the CHECK-constrained values the backend accepts.
const INTERESTS = ['AI / ML', 'Web Dev', 'Mobile', 'Blockchain', 'Cybersecurity', 'IoT',
  'HealthTech', 'FinTech', 'Gaming', 'AR / VR', 'Data Science', 'Open Innovation',
  'Cloud / DevOps', 'Robotics', 'Sustainability'];
const YEARS = ['1st', '2nd', '3rd', '4th', '5th', 'Working Professional'];
const EXPERIENCE = [
  { value: 'beginner', label: 'Beginner', hint: 'First few hackathons' },
  { value: 'intermediate', label: 'Intermediate', hint: 'A handful under my belt' },
  { value: 'advanced', label: 'Advanced', hint: 'I have placed before' },
];
const FORMATS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'In person' },
  { value: 'both', label: 'Either' },
];
const TEAMS = [
  { value: 'solo', label: 'Solo' },
  { value: 'team', label: 'In a team' },
  { value: 'either', label: 'Either' },
];

/**
 * Without this page the profiles table stays empty, so the recommender has
 * nothing to match on.
 */
export default function OnboardingPage() {
  const router = useRouter();
  // Set only when the auth callback sent us here without being able to check
  // the profile itself. A direct visit has no flag and always shows the form,
  // so editing your interests still works.
  const isFirstRun = useSearchParams().get('new') === '1';
  const { user, loading: authLoading } = useUser();
  const { showToast, toastElement } = useToast();

  const [form, setForm] = useState<Profile>({ id: '', interests: [], format_pref: 'both', team_pref: 'either' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchProfile()
      .then((p) => {
        if (isFirstRun && p.interests?.length) return router.replace('/explore');
        setForm({ ...p, interests: p.interests ?? [] });
      })
      .catch(() => showToast('Could not load your profile', 'error'))
      .finally(() => setLoading(false));
  }, [user, showToast, isFirstRun, router]);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleInterest = (interest: string) =>
    setForm((f) => {
      const current = f.interests ?? [];
      return {
        ...f,
        interests: current.includes(interest)
          ? current.filter((i) => i !== interest)
          : [...current, interest],
      };
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.interests?.length) return showToast('Pick at least one interest', 'error');

    setSaving(true);
    try {
      await updateProfile({
        display_name: form.display_name || null,
        college: form.college || null,
        year_of_study: form.year_of_study || null,
        interests: form.interests,
        experience: form.experience || null,
        format_pref: form.format_pref || 'both',
        team_pref: form.team_pref || 'either',
        onboarding_complete: true,
      });
      showToast('Profile saved');
      router.push('/for-you');
    } catch {
      showToast('Could not save your profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Auth resolves after hydration; showing the page first would flash the
  // wrong content at signed-out visitors on these prerendered routes.
  if (authLoading) {
    return (
      <div className="page">
        <div className="container-narrow">
          <div className="skeleton" style={{ height: 320 }} />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="container-narrow emptyState">
          <h1 className="pageTitle">Set up your profile</h1>
          <p>Sign in first — your profile is what the recommendations are built from.</p>
          <Link href="/login" className="btn btnPrimary">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container-narrow">
        <h1 className="pageTitle">Tell us what you build</h1>
        <p className="pageSub">
          This is what your matches are built from. Takes about a minute.
        </p>

        {loading ? (
          <div className="skeleton" style={{ height: 400 }} />
        ) : (
          <form onSubmit={save} className={styles.form}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Interests <span className={styles.req}>required</span></legend>
              <p className={styles.hint}>Pick everything you would actually build for.</p>
              <div className={styles.chips}>
                {INTERESTS.map((i) => {
                  const on = form.interests?.includes(i);
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => toggleInterest(i)}
                      aria-pressed={on}
                      className={on ? styles.chipOn : styles.chipOff}
                    >
                      {i}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Experience</legend>
              <div className={styles.options}>
                {EXPERIENCE.map((o) => (
                  <label key={o.value} className={form.experience === o.value ? styles.optionOn : styles.option}>
                    <input
                      type="radio"
                      name="experience"
                      value={o.value}
                      checked={form.experience === o.value}
                      onChange={() => set('experience', o.value)}
                      className="srOnly"
                    />
                    <span className={styles.optionLabel}>{o.label}</span>
                    <span className={styles.optionHint}>{o.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.row}>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Format</legend>
                <div className={styles.inline}>
                  {FORMATS.map((o) => (
                    <label key={o.value} className={form.format_pref === o.value ? styles.pillOn : styles.pill}>
                      <input
                        type="radio"
                        name="format"
                        checked={form.format_pref === o.value}
                        onChange={() => set('format_pref', o.value)}
                        className="srOnly"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Team</legend>
                <div className={styles.inline}>
                  {TEAMS.map((o) => (
                    <label key={o.value} className={form.team_pref === o.value ? styles.pillOn : styles.pill}>
                      <input
                        type="radio"
                        name="team"
                        checked={form.team_pref === o.value}
                        onChange={() => set('team_pref', o.value)}
                        className="srOnly"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="display_name">Name</label>
                <input
                  id="display_name"
                  className="input"
                  value={form.display_name ?? ''}
                  onChange={(e) => set('display_name', e.target.value)}
                  placeholder="How should we greet you?"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="college">College or company</label>
                <input
                  id="college"
                  className="input"
                  value={form.college ?? ''}
                  onChange={(e) => set('college', e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="year">Year of study</label>
              <select
                id="year"
                className="select"
                value={form.year_of_study ?? ''}
                onChange={(e) => set('year_of_study', e.target.value || null)}
              >
                <option value="">Prefer not to say</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div className={styles.submit}>
              <button type="submit" className="btn btnPrimary" disabled={saving}>
                {saving ? 'Saving…' : 'Save and see my matches'}
              </button>
              <Link href="/explore" className="btn">Skip for now</Link>
            </div>
          </form>
        )}
      </div>
      {toastElement}
    </div>
  );
}
