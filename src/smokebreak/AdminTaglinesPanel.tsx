// Admin taglines CMS panel for rotating cadence, bulk-importing jokes, and toggling or deleting taglines.

import { useEffect, useState, type FormEvent } from 'react';
import {
  addAdminTaglines,
  deleteAdminTagline,
  fetchAdminTaglines,
  updateAdminTagline,
} from './accountClient';
import {
  type PlayerProfile,
  type TaglineCadence,
  type TaglineCollection,
  type TaglineItem,
} from './shiftStorage';

const CADENCE_OPTIONS: Array<{ value: TaglineCadence; label: string }> = [
  { value: '60s', label: 'Every 1 Minute' },
  { value: '5m', label: 'Every 5 Minutes' },
  { value: '15m', label: 'Every 15 Minutes' },
  { value: '1h', label: 'Every 1 Hour' },
  { value: 'daily', label: 'Daily Rotation' },
  { value: 'per_shift', label: 'Every Shift' },
];

export function AdminTaglinesPanel({
  profile,
  onTaglinesUpdated,
}: {
  profile: PlayerProfile;
  onTaglinesUpdated?: (collection: TaglineCollection) => void;
}) {
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [adminCadence, setAdminCadence] = useState<TaglineCadence>('60s');
  const [adminTaglines, setAdminTaglines] = useState<TaglineItem[]>([]);
  const [newJokesDraft, setNewJokesDraft] = useState('');

  const syncAdminState = (data: TaglineCollection, notifyParent = false) => {
    setAdminCadence(data.cadence);
    setAdminTaglines(data.taglines);
    if (notifyParent && onTaglinesUpdated) {
      const activeOnly = data.taglines.filter(t => t.isActive);
      onTaglinesUpdated({ cadence: data.cadence, taglines: activeOnly });
    }
  };

  useEffect(() => {
    if (!profile.isAdmin) return;
    let cancelled = false;
    setAdminBusy(true);
    setAdminError(null);
    void fetchAdminTaglines().then(res => {
      if (cancelled) return;
      setAdminBusy(false);
      if (res.ok) {
        syncAdminState(res.data, false);
      } else {
        setAdminError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profile.isAdmin]);

  if (!profile.isAdmin) return null;

  const handleCadenceChange = async (nextCadence: TaglineCadence) => {
    setAdminBusy(true);
    setAdminError(null);
    setAdminNotice(null);
    const res = await updateAdminTagline({ cadence: nextCadence });
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    syncAdminState(res.data, true);
    setAdminNotice(`Rotation cadence updated to ${nextCadence}.`);
  };

  const handleAddJokes = async (event: FormEvent) => {
    event.preventDefault();
    if (!newJokesDraft.trim()) return;
    setAdminBusy(true);
    setAdminError(null);
    setAdminNotice(null);
    const res = await addAdminTaglines(newJokesDraft);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    setNewJokesDraft('');
    syncAdminState(res.data, true);
    setAdminNotice(`Added ${res.addedCount} tagline${res.addedCount === 1 ? '' : 's'} to database.`);
  };

  const handleToggleJoke = async (item: TaglineItem) => {
    setAdminBusy(true);
    setAdminError(null);
    const res = await updateAdminTagline({ id: item.id, isActive: !item.isActive });
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    syncAdminState(res.data, true);
  };

  const handleDeleteJoke = async (id: number) => {
    setAdminBusy(true);
    setAdminError(null);
    const res = await deleteAdminTagline(id);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    syncAdminState(res.data, true);
    setAdminNotice(`Deleted tagline #${id}.`);
  };

  return (
    <div className="proto-chatgpt-section">
      {adminError && (
        <div className="proto-error" role="alert">
          {adminError}
        </div>
      )}
      {adminNotice && (
        <div className="admin-notice" role="status">
          {adminNotice}
        </div>
      )}

      <div className="proto-chatgpt-row">
        <div>
          <strong>Rotation Cadence</strong>
          <small>Controls how often the top-bar joke rotates across all players.</small>
        </div>
        <select
          className="admin-cadence-select"
          aria-label="Tagline rotation cadence"
          value={adminCadence}
          disabled={adminBusy}
          onChange={e => void handleCadenceChange(e.target.value as TaglineCadence)}
        >
          {CADENCE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <form className="admin-add-form" onSubmit={handleAddJokes}>
        <label htmlFor="admin-joke-textarea">
          <strong>Add or Bulk-Import Jokes ({adminTaglines.length} in DB)</strong>
          <small>
            Renders as: <em>&ldquo;idleSmoke — Where &lt;your joke&gt;&rdquo;</em> (e.g. <em>&ldquo;Where you&apos;re always allotted 15 minutes for a smoke break.&rdquo;</em>). Paste 1 or up to 250 lines at once.
          </small>
        </label>
        <textarea
          id="admin-joke-textarea"
          className="admin-joke-textarea"
          rows={3}
          placeholder="you're always allotted 15 minutes for a smoke break.&#10;the productivity metrics are made up and the shift clock doesn't matter."
          value={newJokesDraft}
          onChange={e => setNewJokesDraft(e.target.value)}
          disabled={adminBusy}
        />
        <div className="admin-add-actions">
          <button type="submit" className="ship" disabled={adminBusy || !newJokesDraft.trim()}>
            {adminBusy ? 'Saving...' : '+ Add / Bulk Import to DB'}
          </button>
        </div>
      </form>

      <div className="admin-joke-list" role="region" aria-label="Tagline database list">
        {adminTaglines.map(item => (
          <div
            key={item.id}
            className={`admin-joke-row ${item.isActive ? '' : 'is-inactive'}`}
          >
            <span className="admin-joke-id">#{item.id}</span>
            <span className="admin-joke-text">Where {item.jokeText.replace(/^where\s+/i, '')}</span>
            <div className="admin-joke-btns">
              <button
                type="button"
                className="proto-acct-btn-secondary"
                disabled={adminBusy}
                onClick={() => void handleToggleJoke(item)}
              >
                {item.isActive ? 'Active' : 'Paused'}
              </button>
              <button
                type="button"
                className="proto-acct-btn-danger-outline"
                disabled={adminBusy}
                onClick={() => void handleDeleteJoke(item.id)}
                aria-label={`Delete tagline ${item.id}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
