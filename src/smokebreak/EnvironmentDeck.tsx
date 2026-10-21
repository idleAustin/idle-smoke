// 12-sector break environment catalog, SVG blueprint placeholders, 3D lighting palettes, and Phase-scoped bottom deck.

import { useEffect, useState } from 'react';
import {
  SECTOR_QUOTAS,
  UNLOCK_THRESHOLDS,
  getUnlockedEnvironments,
  isEditableEventTarget,
  type EnvironmentId,
} from './smokeBreak';

export type { EnvironmentId };

export type CampaignPhaseId = 1 | 2 | 3;

export interface EnvironmentLighting {
  sky: number;
  ground: number;
  sun: number;
  sunIntensity: number;
  rim: number;
}

export interface SmokeEnvironment {
  id: EnvironmentId;
  phase: CampaignPhaseId;
  sectorOrder: number;
  code: string;
  keyHint: string;
  name: string;
  sector: string;
  vibe: string;
  weather: string;
  risk: string;
  riskTone: 'success' | 'warning' | 'error';
  image: string;
  isPlaceholderArt: boolean;
  sectorQuotaRequired: number;
  unlockSmokedRequired: number;
  coords: { x: string; y: string };
  lighting: EnvironmentLighting;
}

export function resolveEnvironmentImagePath(
  assetPath: string,
  baseUrl: string = import.meta.env.BASE_URL
): string {
  const cleanAsset = assetPath.replace(/^\/+/, '');
  const trimmedBase = baseUrl.trim();
  const normalizedBase =
    trimmedBase === '' ? '/' : trimmedBase.endsWith('/') ? trimmedBase : `${trimmedBase}/`;
  return `${normalizedBase}${cleanAsset}`;
}

/** Builds a clean architectural blueprint SVG data URI for Phase 2 & 3 sectors before photo assets arrive. */
function buildBlueprintPlaceholderSvg(
  code: string,
  title: string,
  subtitle: string,
  primaryHex: string,
  secondaryHex: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0a0a0c"/>
        <stop offset="55%" stop-color="#121216"/>
        <stop offset="100%" stop-color="${secondaryHex}" stop-opacity="0.35"/>
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${primaryHex}" stroke-width="0.7" stroke-opacity="0.18"/>
      </pattern>
    </defs>
    <rect width="800" height="450" fill="url(#bg)"/>
    <rect width="800" height="450" fill="url(#grid)"/>
    <g stroke="${primaryHex}" stroke-opacity="0.32" fill="none" stroke-width="1.5">
      <rect x="48" y="42" width="704" height="366" rx="6"/>
      <line x1="48" y1="110" x2="752" y2="110" stroke-dasharray="6 6"/>
      <path d="M 520 360 L 620 210 L 710 210 L 710 360 Z"/>
      <path d="M 420 360 L 420 160 L 540 160 L 540 360"/>
      <circle cx="620" cy="145" r="28" stroke-dasharray="4 4"/>
    </g>
    <text x="72" y="86" fill="${primaryHex}" font-family="monospace" font-weight="700" font-size="16" letter-spacing="3">${code} // ARCHITECTURAL BLUEPRINT PLACEHOLDER</text>
    <text x="72" y="295" fill="#f4f4f5" font-family="sans-serif" font-weight="800" font-size="34">${title}</text>
    <text x="72" y="330" fill="#a1a1aa" font-family="monospace" font-weight="500" font-size="15" letter-spacing="1">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const ENVIRONMENTS: readonly SmokeEnvironment[] = [
  // Phase 1: Started from the Bottom
  {
    id: 'alleyway',
    phase: 1,
    sectorOrder: 1,
    code: 'SEC-01',
    keyHint: '1',
    name: 'Alleyway',
    sector: 'SECTOR 01 · EAST BRICK ALLEY',
    vibe: 'Sodium Vapor · Wet Asphalt',
    weather: '46°F · Light Drizzle',
    risk: 'LOW SUPERVISION',
    riskTone: 'success',
    image: resolveEnvironmentImagePath('environments/alleyway.jpg'),
    isPlaceholderArt: false,
    sectorQuotaRequired: SECTOR_QUOTAS.alleyway,
    unlockSmokedRequired: UNLOCK_THRESHOLDS.alleyway,
    coords: { x: '17%', y: '70%' },
    lighting: {
      sky: 0x8fb8a8,
      ground: 0x2b1d12,
      sun: 0xffb156,
      sunIntensity: 3.8,
      rim: 0x84cc16,
    },
  },
  {
    id: 'restaurant',
    phase: 1,
    sectorOrder: 2,
    code: 'SEC-02',
    keyHint: '2',
    name: 'Behind a Restaurant',
    sector: 'SECTOR 02 · KITCHEN SERVICE EXIT',
    vibe: 'Caged Bulb · Milk Crates',
    weather: '52°F · Kitchen Steam',
    risk: 'CHEF ON LINE',
    riskTone: 'warning',
    image: resolveEnvironmentImagePath('environments/restaurant.jpg'),
    isPlaceholderArt: false,
    sectorQuotaRequired: SECTOR_QUOTAS.restaurant,
    unlockSmokedRequired: UNLOCK_THRESHOLDS.restaurant,
    coords: { x: '37%', y: '34%' },
    lighting: {
      sky: 0xa6c8d8,
      ground: 0x332417,
      sun: 0xffcb78,
      sunIntensity: 4.0,
      rim: 0x38bdf8,
    },
  },
  {
    id: 'parking-garage',
    phase: 1,
    sectorOrder: 3,
    code: 'SEC-03',
    keyHint: '3',
    name: 'Parking Garage',
    sector: 'SECTOR 03 · SUB-LEVEL B2 DECK',
    vibe: 'Fluorescent · Raw Concrete',
    weather: '58°F · Stale Draft',
    risk: 'BLIND CAMERA',
    riskTone: 'success',
    image: resolveEnvironmentImagePath('environments/parking-garage.jpg'),
    isPlaceholderArt: false,
    sectorQuotaRequired: SECTOR_QUOTAS['parking-garage'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['parking-garage'],
    coords: { x: '56%', y: '68%' },
    lighting: {
      sky: 0xb8f2d0,
      ground: 0x1c262b,
      sun: 0xd4ffdf,
      sunIntensity: 3.2,
      rim: 0x84cc16,
    },
  },
  {
    id: 'dumpster',
    phase: 1,
    sectorOrder: 4,
    code: 'SEC-04',
    keyHint: '4',
    name: 'By a Dumpster',
    sector: 'SECTOR 04 · LOADING DOCK CORRAL',
    vibe: 'Floodlight · Rusted Steel',
    weather: '44°F · Night Mist',
    risk: 'SHIFT LEAD NEARBY',
    riskTone: 'error',
    image: resolveEnvironmentImagePath('environments/dumpster.jpg'),
    isPlaceholderArt: false,
    sectorQuotaRequired: SECTOR_QUOTAS.dumpster,
    unlockSmokedRequired: UNLOCK_THRESHOLDS.dumpster,
    coords: { x: '73%', y: '30%' },
    lighting: {
      sky: 0x9ab0c7,
      ground: 0x24281e,
      sun: 0xffe0a3,
      sunIntensity: 3.6,
      rim: 0x84cc16,
    },
  },
  // Phase 2: Middle Class
  {
    id: 'office-sidewalk',
    phase: 2,
    sectorOrder: 5,
    code: 'SEC-05',
    keyHint: '1',
    name: 'Office Sidewalk',
    sector: 'SECTOR 05 · CURBSIDE ASH URN',
    vibe: 'Beige Precast · 25ft From Doors',
    weather: '61°F · Commuter Exhaust',
    risk: 'BADGE SWIPE WATCH',
    riskTone: 'success',
    image: buildBlueprintPlaceholderSvg(
      'SEC-05',
      'Office Sidewalk',
      'CURBSIDE ASH URN · 25FT FROM GLASS DOORS',
      '#38bdf8',
      '#1e293b'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['office-sidewalk'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['office-sidewalk'],
    coords: { x: '17%', y: '70%' },
    lighting: {
      sky: 0xcbd5e1,
      ground: 0x1e293b,
      sun: 0xf8fafc,
      sunIntensity: 3.4,
      rim: 0x38bdf8,
    },
  },
  {
    id: 'breakroom-patio',
    phase: 2,
    sectorOrder: 6,
    code: 'SEC-06',
    keyHint: '2',
    name: 'Breakroom Patio',
    sector: 'SECTOR 06 · CONCRETE PICNIC TABLE',
    vibe: 'Wilted Planters · Humming Vending',
    weather: '64°F · Overcast Glare',
    risk: 'SLACK STATUS AWAY',
    riskTone: 'warning',
    image: buildBlueprintPlaceholderSvg(
      'SEC-06',
      'Breakroom Patio',
      'CONCRETE PICNIC TABLE · VENDING HUM',
      '#84cc16',
      '#1e293b'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['breakroom-patio'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['breakroom-patio'],
    coords: { x: '37%', y: '34%' },
    lighting: {
      sky: 0x94a3b8,
      ground: 0x1e293b,
      sun: 0xe2e8f0,
      sunIntensity: 3.3,
      rim: 0x84cc16,
    },
  },
  {
    id: 'strip-mall-median',
    phase: 2,
    sectorOrder: 7,
    code: 'SEC-07',
    keyHint: '3',
    name: 'Strip-Mall Median',
    sector: 'SECTOR 07 · RETENTION POND GRAVEL',
    vibe: 'Cracked Curbing · Neon Tax Sign',
    weather: '66°F · Humid Haze',
    risk: 'PROPERTY MANAGER',
    riskTone: 'warning',
    image: buildBlueprintPlaceholderSvg(
      'SEC-07',
      'Strip-Mall Median',
      'RETENTION POND GRAVEL · LOT B DIVIDER',
      '#f59e0b',
      '#292524'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['strip-mall-median'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['strip-mall-median'],
    coords: { x: '56%', y: '68%' },
    lighting: {
      sky: 0xd6d3d1,
      ground: 0x292524,
      sun: 0xfde68a,
      sunIntensity: 3.6,
      rim: 0xf59e0b,
    },
  },
  {
    id: 'designated-gazebo',
    phase: 2,
    sectorOrder: 8,
    code: 'SEC-08',
    keyHint: '4',
    name: 'Designated Gazebo',
    sector: 'SECTOR 08 · PLEXIGLASS SMOKING SHED',
    vibe: 'Yellowed Acrylic · Lot C Corner',
    weather: '59°F · Crosswind Rattle',
    risk: 'HR COMPLIANCE CAM',
    riskTone: 'error',
    image: buildBlueprintPlaceholderSvg(
      'SEC-08',
      'Designated Gazebo',
      'PLEXIGLASS SMOKING SHED · HR LOT C',
      '#38bdf8',
      '#172554'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['designated-gazebo'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['designated-gazebo'],
    coords: { x: '73%', y: '30%' },
    lighting: {
      sky: 0x93c5fd,
      ground: 0x172554,
      sun: 0xe0f2fe,
      sunIntensity: 3.5,
      rim: 0x38bdf8,
    },
  },
  // Phase 3: White-Collar
  {
    id: 'executive-balcony',
    phase: 3,
    sectorOrder: 9,
    code: 'SEC-09',
    keyHint: '1',
    name: 'Executive Balcony',
    sector: 'SECTOR 09 · 84TH FLOOR CORNER TERRACE',
    vibe: 'Mahogany Rail · Skyline Glass',
    weather: '68°F · High-Altitude Breeze',
    risk: 'ZERO SUPERVISION',
    riskTone: 'success',
    image: buildBlueprintPlaceholderSvg(
      'SEC-09',
      'Executive Balcony',
      '84TH FLOOR CORNER TERRACE · SKYLINE',
      '#f59e0b',
      '#1e1b4b'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['executive-balcony'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['executive-balcony'],
    coords: { x: '17%', y: '70%' },
    lighting: {
      sky: 0xc7d2fe,
      ground: 0x1e1b4b,
      sun: 0xfde047,
      sunIntensity: 4.1,
      rim: 0xf59e0b,
    },
  },
  {
    id: 'concert-side-stage',
    phase: 3,
    sectorOrder: 10,
    code: 'SEC-10',
    keyHint: '2',
    name: 'Concert Side-Stage',
    sector: 'SECTOR 10 · VIP ALL-ACCESS RISER',
    vibe: 'Subwoofer Stack · Lanyard Glow',
    weather: '72°F · Pyrotechnic Haze',
    risk: 'TOUR MANAGER NOD',
    riskTone: 'warning',
    image: buildBlueprintPlaceholderSvg(
      'SEC-10',
      'Concert Side-Stage',
      'VIP ALL-ACCESS RISER · AMP WALL',
      '#f43f5e',
      '#3b0764'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['concert-side-stage'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['concert-side-stage'],
    coords: { x: '37%', y: '34%' },
    lighting: {
      sky: 0xf0abfc,
      ground: 0x3b0764,
      sun: 0xfda4af,
      sunIntensity: 4.2,
      rim: 0xf43f5e,
    },
  },
  {
    id: 'superyacht-aft-deck',
    phase: 3,
    sectorOrder: 11,
    code: 'SEC-11',
    keyHint: '3',
    name: 'Superyacht Aft Deck',
    sector: 'SECTOR 11 · MONACO HARBOR MOORING',
    vibe: 'Burmese Teak · Champagne Bucket',
    weather: '74°F · Mediterranean Spray',
    risk: 'MARITIME SOVEREIGN',
    riskTone: 'success',
    image: buildBlueprintPlaceholderSvg(
      'SEC-11',
      'Superyacht Aft Deck',
      'MONACO HARBOR MOORING · TEAK AFT',
      '#10b981',
      '#042f2e'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['superyacht-aft-deck'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['superyacht-aft-deck'],
    coords: { x: '56%', y: '68%' },
    lighting: {
      sky: 0x99f6e4,
      ground: 0x042f2e,
      sun: 0xfef08a,
      sunIntensity: 4.0,
      rim: 0x10b981,
    },
  },
  {
    id: 'penthouse-helipad',
    phase: 3,
    sectorOrder: 12,
    code: 'SEC-12',
    keyHint: '4',
    name: 'Penthouse Helipad',
    sector: 'SECTOR 12 · SOVEREIGN ROOFTOP PAD',
    vibe: 'Gold Ashtray · Rotor Wash',
    weather: '65°F · Stratospheric Calm',
    risk: 'YOU OWN THE BUILDING',
    riskTone: 'error',
    image: buildBlueprintPlaceholderSvg(
      'SEC-12',
      'Penthouse Helipad',
      'SOVEREIGN ROOFTOP PAD · HELIPAD',
      '#84cc16',
      '#422006'
    ),
    isPlaceholderArt: true,
    sectorQuotaRequired: SECTOR_QUOTAS['penthouse-helipad'],
    unlockSmokedRequired: UNLOCK_THRESHOLDS['penthouse-helipad'],
    coords: { x: '73%', y: '30%' },
    lighting: {
      sky: 0xfef08a,
      ground: 0x422006,
      sun: 0xffffff,
      sunIntensity: 4.4,
      rim: 0x84cc16,
    },
  },
];

export function getEnvironment(id: EnvironmentId): SmokeEnvironment {
  return ENVIRONMENTS.find(env => env.id === id) ?? ENVIRONMENTS[0];
}

export function EnvironmentDeck({
  current,
  onSelect,
  lifetimeSmoked = 0,
  unlockedEnvironments,
  unlockedPhase = 1,
  shiftStarted = false,
}: {
  current: SmokeEnvironment;
  onSelect: (id: EnvironmentId) => void;
  lifetimeSmoked?: number;
  unlockedEnvironments?: readonly EnvironmentId[];
  unlockedPhase?: CampaignPhaseId;
  shiftStarted?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<CampaignPhaseId>(current.phase);

  useEffect(() => {
    setSelectedPhase(current.phase);
  }, [current.phase]);

  const effectiveUnlocked =
    unlockedEnvironments ?? (getUnlockedEnvironments(lifetimeSmoked) as EnvironmentId[]);
  const phaseEnvironments = ENVIRONMENTS.filter(env => env.phase === selectedPhase);

  useEffect(() => {
    if (shiftStarted) return;
    const onKey = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < phaseEnvironments.length) {
        onSelect(phaseEnvironments[index].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect, phaseEnvironments, shiftStarted]);

  return (
    <section
      className={`hud-panel env-deck ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Smoke break environment"
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="env-deck-header">
        <div>
          <span className="eyebrow">BREAK ENVIRONMENT · {current.sector}</span>
          <strong>
            {current.name} <span className="env-deck-vibe">— {current.vibe}</span>
          </strong>
        </div>
        <div className="env-deck-actions">
          <div className="env-phase-switcher" role="group" aria-label="Campaign phase">
            {([1, 2, 3] as const).map(phaseId => {
              const phaseLocked = phaseId > unlockedPhase && !effectiveUnlocked.some(id => getEnvironment(id).phase === phaseId);
              return (
                <button
                  key={phaseId}
                  type="button"
                  className={`env-phase-pill ${selectedPhase === phaseId ? 'active' : ''} ${phaseLocked ? 'is-locked' : ''}`}
                  aria-pressed={selectedPhase === phaseId}
                  onClick={e => {
                    e.currentTarget.blur();
                    setSelectedPhase(phaseId);
                  }}
                >
                  P{phaseId}
                </button>
              );
            })}
          </div>
          <span className={`status-pill status-pill-${current.riskTone}`}>{current.risk}</span>
          <button
            type="button"
            className="env-collapse-btn"
            aria-expanded={!collapsed}
            onClick={e => {
              e.currentTarget.blur();
              setCollapsed(c => !c);
            }}
          >
            {collapsed ? `Show Spots (${phaseEnvironments.length})` : 'Minimize'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="env-deck-grid" role="radiogroup" aria-label="Environment options">
          {phaseEnvironments.map(env => {
            const active = env.id === current.id;
            const unlocked = unlockedEnvironments
              ? effectiveUnlocked.includes(env.id)
              : effectiveUnlocked.includes(env.id) || lifetimeSmoked >= env.unlockSmokedRequired;
            return (
              <button
                key={env.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`env-spot-card ${active ? 'active' : ''} ${unlocked ? 'is-unlocked' : 'is-milestone-locked'}`}
                onClick={e => {
                  e.currentTarget.blur();
                  onSelect(env.id);
                }}
              >
                <div className="env-spot-thumb">
                  <img src={env.image} alt={env.name} loading="eager" />
                  <span className="env-spot-kbd">{env.keyHint}</span>
                  <span
                    className={`env-spot-unlock-tag ${unlocked ? 'unlocked' : 'locked'}`}
                    aria-label={
                      unlocked
                        ? `${env.name} unlocked`
                        : `Unlock milestone: ${env.unlockSmokedRequired} lifetime cigarettes`
                    }
                  >
                    {unlocked ? 'UNLOCKED' : `${env.unlockSmokedRequired} BUTTS`}
                  </span>
                  {active && <span className="env-spot-active-tag">ACTIVE</span>}
                </div>
                <div className="env-spot-body">
                  <strong>{env.name}</strong>
                  <span>{unlocked ? env.weather : `${env.weather} · Quota ${env.sectorQuotaRequired} butts`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
