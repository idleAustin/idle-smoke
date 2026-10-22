// Smooth-vector Nice Avatar (Micah-inspired, viewBox 0 0 100 100) operator head generator and Admin-exclusive Scorpion emblem.

import { useEffect, useState } from 'react';
import { resolveEnvironmentImagePath } from './EnvironmentDeck';

export interface OperatorAvatarTraits {
  skinIdx: number;
  headgearIdx: number;
  eyesIdx: number;
  beardIdx: number;
  smokeIdx: number;
  collarIdx: number;
  bgIdx: number;
}

export type OperatorAvatarConfig = OperatorAvatarTraits & {
  useAdminScorpion?: boolean;
};

export const SKIN_PALETTE_OPTIONS = [
  { id: 'ivory', label: 'Warm Ivory', base: '#f8d5b8', shadow: '#dfb08c', hair: '#1e1b24', hairHi: '#4a4458' },
  { id: 'amber', label: 'Golden Amber', base: '#e5a976', shadow: '#c4834e', hair: '#991b1b', hairHi: '#ef4444' },
  { id: 'olive', label: 'Sunlit Olive', base: '#d1986a', shadow: '#a97146', hair: '#111827', hairHi: '#374151' },
  { id: 'bronze', label: 'Rich Bronze', base: '#a46438', shadow: '#7c4722', hair: '#f59e0b', hairHi: '#fde047' },
  { id: 'espresso', label: 'Deep Espresso', base: '#693c23', shadow: '#482613', hair: '#09090b', hairHi: '#3f3f46' },
  { id: 'porcelain', label: 'Cool Rose', base: '#f3c6b6', shadow: '#d49e8d', hair: '#6d28d9', hairHi: '#a78bfa' },
] as const;

export const HEADGEAR_OPTIONS = [
  { id: 'waves', label: 'Long Flowing Waves' },
  { id: 'buns', label: 'Space Buns & Fringe' },
  { id: 'bob', label: 'Sleek Bob & Bangs' },
  { id: 'halo', label: 'Curly Afro Halo' },
  { id: 'quiff', label: 'Nice Swoop Quiff' },
  { id: 'beanie', label: 'Dock Knit Beanie' },
  { id: 'hardhat', label: 'Safety Hard Hat' },
] as const;

export const EYES_OPTIONS = [
  { id: 'lashes', label: 'Winged Cat-Lashes' },
  { id: 'relaxed', label: 'Relaxed Nice Eyes' },
  { id: 'roundshades', label: 'Retro Round Shades' },
  { id: 'cateye', label: 'Cat-Eye Designer Frames' },
  { id: 'heavylids', label: 'Heavy Shift Lids' },
] as const;

export const BEARD_OPTIONS = [
  { id: 'hoops', label: 'Gold Hoops & Blush' },
  { id: 'freckles', label: 'Freckles & Beauty Mark' },
  { id: 'clean', label: 'Clean / Minimal' },
  { id: 'studs', label: 'Lime Ear Studs' },
  { id: 'stubble', label: '5 O-Clock Stubble' },
  { id: 'beard', label: 'Sculpted Dock Beard' },
] as const;

export const SMOKE_PROP_OPTIONS = [
  { id: 'glossylip', label: 'Glossy Lip & Lit Dart' },
  { id: 'smirk', label: 'Nice Smirk & Filter Butt' },
  { id: 'stogie', label: 'Boss Stogie Cigar' },
  { id: 'grin', label: 'Open Grin & Dangling Butt' },
] as const;

export const COLLAR_OPTIONS = [
  { id: 'scoop', label: 'Scoop Top & Gold Chain' },
  { id: 'hivis', label: 'Hi-Vis Safety Vest' },
  { id: 'blazer', label: 'Exec Blazer & Turtleneck' },
  { id: 'hoodie', label: 'Street Hoodie' },
  { id: 'coverall', label: 'Shop Coveralls' },
] as const;

const BG_PALETTE = ['#132219', '#1e162b', '#14202e', '#26171a', '#162326', '#231d13'] as const;

const CURATED_CALLSIGN_TRAITS: Record<string, OperatorAvatarTraits> = {
  'MENTHOL-88': { skinIdx: 0, headgearIdx: 0, eyesIdx: 0, beardIdx: 0, smokeIdx: 0, collarIdx: 0, bgIdx: 1 },
  'ASH-KING': { skinIdx: 3, headgearIdx: 6, eyesIdx: 2, beardIdx: 5, smokeIdx: 2, collarIdx: 1, bgIdx: 0 },
  'NIC-FIT': { skinIdx: 5, headgearIdx: 1, eyesIdx: 3, beardIdx: 1, smokeIdx: 0, collarIdx: 2, bgIdx: 3 },
  'DOCK-BOSS': { skinIdx: 4, headgearIdx: 3, eyesIdx: 0, beardIdx: 0, smokeIdx: 2, collarIdx: 0, bgIdx: 4 },
  'SHIFT-LEAD': { skinIdx: 1, headgearIdx: 2, eyesIdx: 3, beardIdx: 1, smokeIdx: 0, collarIdx: 2, bgIdx: 2 },
  'BURN-RATE': { skinIdx: 2, headgearIdx: 4, eyesIdx: 1, beardIdx: 4, smokeIdx: 1, collarIdx: 3, bgIdx: 5 },
  'CRATE-SITTER': { skinIdx: 0, headgearIdx: 5, eyesIdx: 4, beardIdx: 3, smokeIdx: 3, collarIdx: 4, bgIdx: 0 },
  'VAPOR-LOCK': { skinIdx: 3, headgearIdx: 0, eyesIdx: 2, beardIdx: 0, smokeIdx: 0, collarIdx: 3, bgIdx: 1 },
  'GARAGE-GHOST': { skinIdx: 5, headgearIdx: 2, eyesIdx: 0, beardIdx: 3, smokeIdx: 1, collarIdx: 2, bgIdx: 2 },
  'ROOKIE-04': { skinIdx: 1, headgearIdx: 1, eyesIdx: 1, beardIdx: 1, smokeIdx: 3, collarIdx: 0, bgIdx: 4 },
};

const AVATAR_TRAITS_CACHE_NAME = 'smokebreak.avatarTraits';
const AVATAR_UPDATED_EVENT = 'smokebreak:avatar-updated';
const INK = '#09090b';

export function deriveAvatarTraits(callsign: string): OperatorAvatarTraits {
  const clean = (callsign || 'OPERATOR').trim().toUpperCase();
  if (CURATED_CALLSIGN_TRAITS[clean]) {
    return { ...CURATED_CALLSIGN_TRAITS[clean] };
  }
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return {
    skinIdx: hash % SKIN_PALETTE_OPTIONS.length,
    headgearIdx: (hash >>> 3) % HEADGEAR_OPTIONS.length,
    eyesIdx: (hash >>> 6) % EYES_OPTIONS.length,
    beardIdx: (hash >>> 9) % BEARD_OPTIONS.length,
    smokeIdx: (hash >>> 12) % SMOKE_PROP_OPTIONS.length,
    collarIdx: (hash >>> 15) % COLLAR_OPTIONS.length,
    bgIdx: (hash >>> 18) % BG_PALETTE.length,
  };
}

interface StoredAvatarMap {
  [callsignKey: string]: {
    traits?: Partial<OperatorAvatarTraits> | null;
    useAdminScorpion?: boolean;
  };
}

let memoryAvatarMap: StoredAvatarMap = {};

function readStoredMap(): StoredAvatarMap {
  if (typeof window === 'undefined' || !window.localStorage) return memoryAvatarMap;
  try {
    const raw = window.localStorage.getItem(AVATAR_TRAITS_CACHE_NAME);
    return raw ? (JSON.parse(raw) as StoredAvatarMap) : memoryAvatarMap;
  } catch {
    return memoryAvatarMap;
  }
}

export function getSavedAvatarTraits(callsign: string, isAdmin = false): {
  traits: OperatorAvatarTraits;
  useAdminScorpion: boolean;
  isCustomized: boolean;
} {
  const key = (callsign || 'OPERATOR').trim().toUpperCase();
  const base = deriveAvatarTraits(key);
  const entry = readStoredMap()[key];
  const custom = entry?.traits;
  const traits: OperatorAvatarTraits = custom
    ? {
        skinIdx: Math.abs(custom.skinIdx ?? base.skinIdx) % SKIN_PALETTE_OPTIONS.length,
        headgearIdx: Math.abs(custom.headgearIdx ?? base.headgearIdx) % HEADGEAR_OPTIONS.length,
        eyesIdx: Math.abs(custom.eyesIdx ?? base.eyesIdx) % EYES_OPTIONS.length,
        beardIdx: Math.abs(custom.beardIdx ?? base.beardIdx) % BEARD_OPTIONS.length,
        smokeIdx: Math.abs(custom.smokeIdx ?? base.smokeIdx) % SMOKE_PROP_OPTIONS.length,
        collarIdx: Math.abs(custom.collarIdx ?? base.collarIdx) % COLLAR_OPTIONS.length,
        bgIdx: Math.abs(custom.bgIdx ?? base.bgIdx) % BG_PALETTE.length,
      }
    : base;
  const useAdminScorpion = Boolean(isAdmin) && (entry?.useAdminScorpion ?? true);
  return { traits, useAdminScorpion, isCustomized: Boolean(custom) };
}

export function saveAvatarTraits(
  callsign: string,
  traits: Partial<OperatorAvatarTraits> | null,
  useAdminScorpion?: boolean
): void {
  const key = (callsign || 'OPERATOR').trim().toUpperCase();
  const map = { ...readStoredMap() };
  const prev = map[key] ?? {};
  map[key] = {
    traits: traits === undefined ? prev.traits : traits,
    useAdminScorpion: useAdminScorpion === undefined ? prev.useAdminScorpion : useAdminScorpion,
  };
  memoryAvatarMap = map;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(AVATAR_TRAITS_CACHE_NAME, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
  window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT));
}

export function OperatorAvatar({
  callsign,
  isAdmin = false,
  avatarConfig,
  traitsOverride,
  forceScorpion,
  className = '',
}: {
  callsign: string;
  isAdmin?: boolean;
  avatarConfig?: OperatorAvatarConfig | null;
  traitsOverride?: OperatorAvatarTraits;
  forceScorpion?: boolean;
  className?: string;
}) {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const onUpdate = () => setRevision(r => r + 1);
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate);
  }, []);

  const saved = getSavedAvatarTraits(callsign, isAdmin);
  const showScorpion =
    forceScorpion !== undefined
      ? Boolean(isAdmin) && forceScorpion
      : avatarConfig !== undefined && avatarConfig !== null
        ? Boolean(avatarConfig.useAdminScorpion)
        : Boolean(isAdmin) && saved.useAdminScorpion;

  if (showScorpion) {
    return (
      <img
        className={`operator-avatar-scorpion ${className}`.trim()}
        src={resolveEnvironmentImagePath('avatars/admin-scorpion.jpg')}
        alt={`Admin Scorpion avatar for ${callsign}`}
        aria-label={`Admin Scorpion avatar for ${callsign}`}
      />
    );
  }

  const base = deriveAvatarTraits(callsign);
  const t: OperatorAvatarTraits =
    traitsOverride ??
    (avatarConfig !== undefined && avatarConfig !== null
      ? {
          skinIdx: Math.abs(avatarConfig.skinIdx ?? base.skinIdx) % SKIN_PALETTE_OPTIONS.length,
          headgearIdx: Math.abs(avatarConfig.headgearIdx ?? base.headgearIdx) % HEADGEAR_OPTIONS.length,
          eyesIdx: Math.abs(avatarConfig.eyesIdx ?? base.eyesIdx) % EYES_OPTIONS.length,
          beardIdx: Math.abs(avatarConfig.beardIdx ?? base.beardIdx) % BEARD_OPTIONS.length,
          smokeIdx: Math.abs(avatarConfig.smokeIdx ?? base.smokeIdx) % SMOKE_PROP_OPTIONS.length,
          collarIdx: Math.abs(avatarConfig.collarIdx ?? base.collarIdx) % COLLAR_OPTIONS.length,
          bgIdx: Math.abs(avatarConfig.bgIdx ?? base.bgIdx) % BG_PALETTE.length,
        }
      : saved.isCustomized
        ? saved.traits
        : base);
  const skin = SKIN_PALETTE_OPTIONS[t.skinIdx % SKIN_PALETTE_OPTIONS.length];
  const bg = BG_PALETTE[t.bgIdx % BG_PALETTE.length];
  const headgearId = HEADGEAR_OPTIONS[t.headgearIdx % HEADGEAR_OPTIONS.length].id;
  const eyesId = EYES_OPTIONS[t.eyesIdx % EYES_OPTIONS.length].id;
  const beardId = BEARD_OPTIONS[t.beardIdx % BEARD_OPTIONS.length].id;
  const smokeId = SMOKE_PROP_OPTIONS[t.smokeIdx % SMOKE_PROP_OPTIONS.length].id;
  const collarId = COLLAR_OPTIONS[t.collarIdx % COLLAR_OPTIONS.length].id;

  return (
    <svg
      className={`operator-avatar-svg ${className}`.trim()}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Operator avatar for ${callsign}`}
    >
      <rect width="100" height="100" fill={bg} />
      <circle cx="50" cy="54" r="38" fill="rgba(255,255,255,0.04)" />

      {/* Back Hair Layer (rendered behind ears, neck, and shoulders) */}
      {headgearId === 'waves' && (
        <path
          d="M20 40 C12 58, 15 86, 26 98 L74 98 C85 86, 88 58, 80 40 C74 20, 26 20, 20 40 Z"
          fill={skin.hair} stroke={INK} strokeWidth="2.8" strokeLinejoin="round"
        />
      )}
      {headgearId === 'buns' && (
        <>
          <circle cx="24" cy="22" r="11" fill={skin.hair} stroke={INK} strokeWidth="2.8" />
          <path d="M19 18 A6 6 0 0 1 27 16" stroke={skin.hairHi} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="76" cy="22" r="11" fill={skin.hair} stroke={INK} strokeWidth="2.8" />
          <path d="M71 18 A6 6 0 0 1 79 16" stroke={skin.hairHi} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {headgearId === 'bob' && (
        <path
          d="M21 38 C17 55, 20 73, 30 76 L70 76 C80 73, 83 55, 79 38 Z"
          fill={skin.hair} stroke={INK} strokeWidth="2.8" strokeLinejoin="round"
        />
      )}
      {headgearId === 'halo' && (
        <circle cx="50" cy="38" r="31" fill={skin.hair} stroke={INK} strokeWidth="2.8" />
      )}

      {/* Collar & Shoulders */}
      {collarId === 'scoop' && (
        <g>
          <path d="M16 100 C18 79, 32 74, 50 74 C68 74, 82 79, 84 100 Z" fill="#84cc16" stroke={INK} strokeWidth="2.8" />
          <path d="M35 76 Q50 90 65 76" fill={skin.base} stroke={INK} strokeWidth="2.4" />
          <path d="M38 82 Q50 93 62 82" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      )}
      {collarId === 'hivis' && (
        <g>
          <path d="M14 100 C17 77, 31 73, 50 73 C69 73, 83 77, 86 100 Z" fill="#1e293b" stroke={INK} strokeWidth="2.8" />
          <path d="M26 76 L35 100 M74 76 L65 100" stroke="#84cc16" strokeWidth="7" />
        </g>
      )}
      {collarId === 'blazer' && (
        <g>
          <path d="M14 100 C17 77, 31 73, 50 73 C69 73, 83 77, 86 100 Z" fill="#18181b" stroke={INK} strokeWidth="2.8" />
          <path d="M38 74 L50 96 L62 74 Z" fill="#f43f5e" stroke={INK} strokeWidth="2.2" />
        </g>
      )}
      {collarId === 'hoodie' && (
        <g>
          <path d="M12 100 C15 75, 30 71, 50 71 C70 71, 85 75, 88 100 Z" fill="#3b82f6" stroke={INK} strokeWidth="2.8" />
          <path d="M43 78 L43 94 M57 78 L57 94" stroke="#f4f4f5" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}
      {collarId === 'coverall' && (
        <g>
          <path d="M14 100 C17 77, 31 73, 50 73 C69 73, 83 77, 86 100 Z" fill="#2563eb" stroke={INK} strokeWidth="2.8" />
          <path d="M38 74 L50 88 L62 74" fill="none" stroke="#f59e0b" strokeWidth="3" />
        </g>
      )}

      {/* Neck & Chin Shadow */}
      <path d="M41 67 L41 80 Q50 84 59 80 L59 67 Z" fill={skin.base} stroke={INK} strokeWidth="2.6" />
      <path d="M42 68 Q50 76 58 68 L58 73 Q50 79 42 73 Z" fill={skin.shadow} />

      {/* Ears & Sculpted Nice Avatar Head */}
      <circle cx="24" cy="51" r="6" fill={skin.base} stroke={INK} strokeWidth="2.6" />
      <circle cx="76" cy="51" r="6" fill={skin.base} stroke={INK} strokeWidth="2.6" />
      <path
        d="M26 42 C26 24, 36 18, 50 18 C64 18, 74 24, 74 42 C74 61, 63 73, 50 73 C37 73, 26 61, 26 42 Z"
        fill={skin.base} stroke={INK} strokeWidth="2.8"
      />

      {/* Inclusive Face & Ear Accents */}
      {beardId === 'hoops' && (
        <g>
          <circle cx="22" cy="58" r="6.5" fill="none" stroke="#fbbf24" strokeWidth="2.6" />
          <circle cx="78" cy="58" r="6.5" fill="none" stroke="#fbbf24" strokeWidth="2.6" />
          <ellipse cx="35" cy="54" rx="5" ry="2.6" fill="#f43f5e" opacity="0.35" />
          <ellipse cx="65" cy="54" rx="5" ry="2.6" fill="#f43f5e" opacity="0.35" />
        </g>
      )}
      {beardId === 'freckles' && (
        <g>
          <ellipse cx="35" cy="54" rx="5" ry="2.5" fill="#f43f5e" opacity="0.28" />
          <ellipse cx="65" cy="54" rx="5" ry="2.5" fill="#f43f5e" opacity="0.28" />
          <circle cx="34" cy="53" r="1" fill={skin.shadow} />
          <circle cx="38" cy="54" r="1" fill={skin.shadow} />
          <circle cx="62" cy="54" r="1" fill={skin.shadow} />
          <circle cx="66" cy="53" r="1" fill={skin.shadow} />
          <circle cx="59" cy="59" r="1.3" fill={INK} />
        </g>
      )}
      {beardId === 'studs' && (
        <g>
          <circle cx="23" cy="55" r="2.8" fill="#84cc16" stroke={INK} strokeWidth="1.5" />
          <circle cx="77" cy="55" r="2.8" fill="#84cc16" stroke={INK} strokeWidth="1.5" />
        </g>
      )}
      {beardId === 'stubble' && (
        <path
          d="M28 52 C28 65, 38 72, 50 72 C62 72, 72 65, 72 52 C70 61, 61 66, 50 66 C39 66, 30 61, 28 52 Z"
          fill={INK} opacity="0.18"
        />
      )}
      {beardId === 'beard' && (
        <path
          d="M26 50 C26 66, 36 75, 50 75 C64 75, 74 66, 74 50 C70 55, 62 56, 50 56 C38 56, 30 55, 26 50 Z"
          fill={skin.hair} stroke={INK} strokeWidth="2.6" strokeLinejoin="round"
        />
      )}

      {/* Expressive Micah Curved Nose */}
      <path d="M50 45 L47 54 Q50 56 53 54" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Eyes, Lashes & Eyewear */}
      {eyesId === 'lashes' && (
        <g>
          <path d="M32 40 Q39 36 44 40 M56 40 Q61 36 68 40" stroke={INK} strokeWidth="2.3" fill="none" strokeLinecap="round" />
          <path d="M31 46 Q38 42 44 46 M56 46 Q62 42 69 46" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M31 46 L28 43 M69 46 L72 43" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="38" cy="47" r="3.1" fill={INK} />
          <circle cx="62" cy="47" r="3.1" fill={INK} />
          <circle cx="39.2" cy="45.8" r="1.1" fill="#fff" />
          <circle cx="63.2" cy="45.8" r="1.1" fill="#fff" />
        </g>
      )}
      {eyesId === 'relaxed' && (
        <g>
          <path d="M33 40 Q38 38 43 40 M57 40 Q62 38 67 40" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <circle cx="38" cy="47" r="3" fill={INK} />
          <circle cx="62" cy="47" r="3" fill={INK} />
          <circle cx="39" cy="46" r="1" fill="#fff" />
          <circle cx="63" cy="46" r="1" fill="#fff" />
        </g>
      )}
      {eyesId === 'roundshades' && (
        <g>
          <circle cx="38" cy="46" r="8" fill="#18181b" stroke={INK} strokeWidth="2.6" />
          <circle cx="62" cy="46" r="8" fill="#18181b" stroke={INK} strokeWidth="2.6" />
          <path d="M46 46 L54 46 M26 45 L30 46 M70 46 L74 45" stroke={INK} strokeWidth="2.6" />
          <path d="M34 43 L38 40 M58 43 L62 40" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {eyesId === 'cateye' && (
        <g>
          <path d="M27 42 L46 44 L44 52 Q35 53 29 48 Z" fill="rgba(132,204,22,0.22)" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M73 42 L54 44 L56 52 Q65 53 71 48 Z" fill="rgba(132,204,22,0.22)" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M46 45 L54 45" stroke={INK} strokeWidth="2.4" />
          <circle cx="38" cy="47" r="2.5" fill={INK} />
          <circle cx="62" cy="47" r="2.5" fill={INK} />
        </g>
      )}
      {eyesId === 'heavylids' && (
        <g>
          <circle cx="38" cy="47" r="3.2" fill={INK} />
          <circle cx="62" cy="47" r="3.2" fill={INK} />
          <path d="M32 45 L44 45 M56 45 L68 45" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
        </g>
      )}

      {/* Front Hair / Headgear Layer */}
      {(headgearId === 'waves' || headgearId === 'buns') && (
        <path
          d="M25 40 C26 20, 40 15, 50 15 C64 15, 74 22, 75 40 C66 28, 56 26, 46 31 C36 35, 30 33, 25 40 Z"
          fill={skin.hair} stroke={INK} strokeWidth="2.6" strokeLinejoin="round"
        />
      )}
      {headgearId === 'bob' && (
        <path
          d="M24 37 C26 19, 38 14, 50 14 C62 14, 74 19, 76 37 L24 37 Z"
          fill={skin.hair} stroke={INK} strokeWidth="2.6" strokeLinejoin="round"
        />
      )}
      {headgearId === 'halo' && (
        <path
          d="M26 34 C32 22, 42 20, 50 20 C58 20, 68 22, 74 34"
          fill="none" stroke={skin.hairHi} strokeWidth="2.4" strokeLinecap="round"
        />
      )}
      {headgearId === 'quiff' && (
        <path
          d="M25 38 C23 21, 37 11, 56 13 C69 14, 79 22, 75 34 C66 26, 54 25, 42 30 C34 33, 28 34, 25 38 Z"
          fill={skin.hair} stroke={INK} strokeWidth="2.6" strokeLinejoin="round"
        />
      )}
      {headgearId === 'beanie' && (
        <g>
          <path d="M24 36 C25 16, 37 12, 50 12 C63 12, 75 16, 76 36 Z" fill="#e11d48" stroke={INK} strokeWidth="2.6" />
          <rect x="22" y="31" width="56" height="8" rx="4" fill="#be123c" stroke={INK} strokeWidth="2.6" />
        </g>
      )}
      {headgearId === 'hardhat' && (
        <g>
          <path d="M23 36 C24 15, 37 11, 50 11 C63 11, 76 15, 77 36 Z" fill="#f59e0b" stroke={INK} strokeWidth="2.6" />
          <path d="M18 35 Q50 31 82 35 L80 39 Q50 36 20 39 Z" fill="#fbbf24" stroke={INK} strokeWidth="2.4" />
        </g>
      )}

      {/* Mouth & Signature Smoke Prop */}
      {smokeId === 'glossylip' && (
        <path d="M43 62 Q47 59 50 61 Q53 59 57 62 Q50 67 43 62 Z" fill="#e11d48" stroke={INK} strokeWidth="2" />
      )}
      {smokeId === 'smirk' && (
        <path d="M42 62 Q50 65 58 60" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      )}
      {smokeId === 'grin' && (
        <path d="M42 60 Q50 68 58 60 Z" fill="#ffffff" stroke={INK} strokeWidth="2.3" strokeLinejoin="round" />
      )}
      {smokeId === 'stogie' ? (
        <g>
          <path d="M42 62 Q50 65 57 61" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <g transform="rotate(8 54 62)">
            <rect x="53" y="59" width="28" height="6.5" rx="3" fill="#78350f" stroke={INK} strokeWidth="2.3" />
            <rect x="59" y="59" width="3.5" height="6.5" fill="#fbbf24" />
            <circle cx="81" cy="62.2" r="3" fill="#f97316" />
          </g>
          <path d="M84 56 C89 48, 82 40, 88 30" fill="none" stroke="#84cc16" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
        </g>
      ) : (
        <g>
          <g transform="rotate(10 53 62)">
            <rect x="53" y="60" width="8" height="4.4" rx="1" fill="#f59e0b" stroke={INK} strokeWidth="2" />
            <rect x="61" y="60" width="17" height="4.4" rx="1" fill="#ffffff" stroke={INK} strokeWidth="2" />
            <rect x="78" y="60" width="3.5" height="4.4" rx="1" fill="#f43f5e" />
          </g>
          <path d="M83 57 C88 49, 80 41, 86 31" fill="none" stroke="#e4e4e7" strokeWidth="2.2" strokeLinecap="round" opacity="0.78" />
        </g>
      )}
    </svg>
  );
}
