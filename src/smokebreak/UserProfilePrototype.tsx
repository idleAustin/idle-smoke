// Locker Mirror & 6-Slot Trait Workshop for the User Profile & Account Settings modal.

import { useEffect, useState, type ReactNode } from 'react';
import {
  BEARD_OPTIONS, COLLAR_OPTIONS, EYES_OPTIONS, HEADGEAR_OPTIONS,
  OperatorAvatar, SKIN_PALETTE_OPTIONS, SMOKE_PROP_OPTIONS,
  deriveAvatarTraits, getSavedAvatarTraits, saveAvatarTraits,
  type OperatorAvatarConfig, type OperatorAvatarTraits,
} from './OperatorAvatar';
import { type PlayerProfile } from './shiftStorage';

export function shouldOpenProfilePrototypeFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has('scoreboard')) return false;
  return params.has('profile') || params.has('variant');
}

const TRAIT_SLOTS: readonly {
  key: keyof OperatorAvatarTraits;
  label: string;
  options: readonly { id: string; label: string }[];
}[] = [
  { key: 'headgearIdx', label: 'Headgear', options: HEADGEAR_OPTIONS },
  { key: 'eyesIdx', label: 'Eyewear', options: EYES_OPTIONS },
  { key: 'smokeIdx', label: 'Smoke Prop', options: SMOKE_PROP_OPTIONS },
  { key: 'beardIdx', label: 'Accents & Facial', options: BEARD_OPTIONS },
  { key: 'collarIdx', label: 'Collar', options: COLLAR_OPTIONS },
  { key: 'skinIdx', label: 'Skin Tone', options: SKIN_PALETTE_OPTIONS },
];

function resolveEditorAvatarState(profile: PlayerProfile) {
  const isAdmin = Boolean(profile.isAdmin);
  if (profile.avatarConfig) {
    const base = deriveAvatarTraits(profile.callsign);
    return {
      traits: {
        skinIdx: Math.abs(profile.avatarConfig.skinIdx ?? base.skinIdx) % SKIN_PALETTE_OPTIONS.length,
        headgearIdx: Math.abs(profile.avatarConfig.headgearIdx ?? base.headgearIdx) % HEADGEAR_OPTIONS.length,
        eyesIdx: Math.abs(profile.avatarConfig.eyesIdx ?? base.eyesIdx) % EYES_OPTIONS.length,
        beardIdx: Math.abs(profile.avatarConfig.beardIdx ?? base.beardIdx) % BEARD_OPTIONS.length,
        smokeIdx: Math.abs(profile.avatarConfig.smokeIdx ?? base.smokeIdx) % SMOKE_PROP_OPTIONS.length,
        collarIdx: Math.abs(profile.avatarConfig.collarIdx ?? base.collarIdx) % COLLAR_OPTIONS.length,
        bgIdx: Math.abs(profile.avatarConfig.bgIdx ?? base.bgIdx) % 6,
      },
      useAdminScorpion: isAdmin && Boolean(profile.avatarConfig.useAdminScorpion),
      isCustomized: true,
    };
  }
  return getSavedAvatarTraits(profile.callsign, isAdmin);
}

export function UserProfilePrototype({
  profile, busy, callsignHeader, onSaveAvatarConfig, onSignOut,
}: {
  profile: PlayerProfile;
  busy?: boolean;
  callsignHeader: ReactNode;
  onSaveAvatarConfig?: (avatarConfig: OperatorAvatarConfig | null) => Promise<void> | void;
  onSignOut: () => void;
}) {
  const isAdmin = Boolean(profile.isAdmin);
  const [savedState, setSavedState] = useState(() => resolveEditorAvatarState(profile));

  useEffect(() => {
    setSavedState(resolveEditorAvatarState(profile));
  }, [profile.callsign, isAdmin, profile.avatarConfig]);

  const { traits, useAdminScorpion } = savedState;
  const showScorpion = isAdmin && useAdminScorpion;

  const updateTrait = (key: keyof OperatorAvatarTraits, nextVal: number) => {
    const nextTraits: OperatorAvatarTraits = { ...traits, [key]: nextVal };
    saveAvatarTraits(profile.callsign, nextTraits, false);
    setSavedState({ traits: nextTraits, useAdminScorpion: false, isCustomized: true });
    void onSaveAvatarConfig?.(nextTraits);
  };

  const randomizeTraits = () => {
    const nextTraits: OperatorAvatarTraits = {
      skinIdx: Math.floor(Math.random() * SKIN_PALETTE_OPTIONS.length),
      headgearIdx: Math.floor(Math.random() * HEADGEAR_OPTIONS.length),
      eyesIdx: Math.floor(Math.random() * EYES_OPTIONS.length),
      beardIdx: Math.floor(Math.random() * BEARD_OPTIONS.length),
      smokeIdx: Math.floor(Math.random() * SMOKE_PROP_OPTIONS.length),
      collarIdx: Math.floor(Math.random() * COLLAR_OPTIONS.length),
      bgIdx: Math.floor(Math.random() * 6),
    };
    saveAvatarTraits(profile.callsign, nextTraits, false);
    setSavedState({ traits: nextTraits, useAdminScorpion: false, isCustomized: true });
    void onSaveAvatarConfig?.(nextTraits);
  };

  const resetToSeed = () => {
    const seeded = deriveAvatarTraits(profile.callsign);
    saveAvatarTraits(profile.callsign, null, isAdmin);
    setSavedState({ traits: seeded, useAdminScorpion: isAdmin, isCustomized: false });
    void onSaveAvatarConfig?.(null);
  };

  const equipAdminScorpion = (enable: boolean) => {
    if (!isAdmin) return;
    saveAvatarTraits(profile.callsign, traits, enable);
    setSavedState(prev => ({ ...prev, useAdminScorpion: enable }));
    void onSaveAvatarConfig?.({ ...traits, ...(enable ? { useAdminScorpion: true } : {}) });
  };

  return (
    <div className="proto-chatgpt-section">
      <div className="proto-prof-var-a">
        <div className="proto-prof-locker-mirror">
          <div className="proto-prof-avatar-stage">
            <OperatorAvatar
              callsign={profile.callsign}
              isAdmin={isAdmin}
              traitsOverride={traits}
              forceScorpion={showScorpion}
            />
          </div>
          {showScorpion ? (
            <span className="proto-prof-scorpion-tag">ADMIN EXCLUSIVE · SCORPION</span>
          ) : (
            <span className="proto-prof-seed-tag">
              {HEADGEAR_OPTIONS[traits.headgearIdx].label} · {SMOKE_PROP_OPTIONS[traits.smokeIdx].label}
            </span>
          )}
          <div className="proto-prof-mirror-btns">
            <button type="button" className="proto-acct-btn-secondary" onClick={randomizeTraits}>
              Randomize
            </button>
            <button type="button" className="proto-acct-btn-secondary" onClick={resetToSeed}>
              Reset to Seed
            </button>
            {isAdmin && (
              <button
                type="button"
                className={`proto-acct-btn-secondary ${useAdminScorpion ? 'active-scorpion' : ''}`}
                onClick={() => equipAdminScorpion(!useAdminScorpion)}
              >
                {useAdminScorpion ? 'Customize Vector Head' : 'Equip Admin Scorpion'}
              </button>
            )}
          </div>
        </div>

        <div className="proto-prof-workshop-col">
          {callsignHeader}
          <div className="proto-prof-trait-grid" aria-label="Operator Trait Workshop">
            {TRAIT_SLOTS.map(slot => (
              <label key={slot.key} className="proto-prof-trait-slot">
                <span>{slot.label}</span>
                <select
                  value={traits[slot.key]}
                  onChange={e => updateTrait(slot.key, Number(e.target.value))}
                >
                  {slot.options.map((opt, idx) => (
                    <option key={opt.id} value={idx}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="proto-chatgpt-row">
            <div>
              <strong>Career Progress</strong>
              <small>
                {profile.lifetimeSmoked} lifetime butts · Best shift: {profile.bestSmoked} butts ·{' '}
                {profile.shiftsCompleted} shifts
              </small>
            </div>
            <span className="proto-chip">{profile.unlockedEnvironments.length}/12 Spots</span>
          </div>
          <div className="proto-chatgpt-row">
            <div>
              <strong>Sign out of this device</strong>
              <small>Return to the login screen while keeping your cloud account safe.</small>
            </div>
            <button type="button" className="proto-acct-btn-secondary" disabled={busy} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
