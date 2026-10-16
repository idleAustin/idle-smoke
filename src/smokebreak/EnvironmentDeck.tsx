import { useEffect, useState } from 'react';
import { UNLOCK_THRESHOLDS, getUnlockedEnvironments, isEditableEventTarget, type EnvironmentId } from './smokeBreak';

export type { EnvironmentId };

export interface EnvironmentLighting {
  sky: number;
  ground: number;
  sun: number;
  sunIntensity: number;
  rim: number;
}

export interface SmokeEnvironment {
  id: EnvironmentId;
  keyHint: string;
  name: string;
  sector: string;
  vibe: string;
  weather: string;
  risk: string;
  riskTone: 'success' | 'warning' | 'error';
  image: string;
  unlockSmokedRequired: number;
  lighting: EnvironmentLighting;
}

const BASE_URL = import.meta.env.BASE_URL;

export const ENVIRONMENTS: readonly SmokeEnvironment[] = [
  {
    id: 'alleyway',
    keyHint: '1',
    name: 'Alleyway',
    sector: 'SECTOR 01 · EAST BRICK ALLEY',
    vibe: 'Sodium Vapor · Wet Asphalt',
    weather: '46°F · Light Drizzle',
    risk: 'LOW SUPERVISION',
    riskTone: 'success',
    image: `${BASE_URL}environments/alleyway.jpg`,
    unlockSmokedRequired: UNLOCK_THRESHOLDS.alleyway,
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
    keyHint: '2',
    name: 'Behind a Restaurant',
    sector: 'SECTOR 02 · KITCHEN SERVICE EXIT',
    vibe: 'Caged Bulb · Milk Crates',
    weather: '52°F · Kitchen Steam',
    risk: 'CHEF ON LINE',
    riskTone: 'warning',
    image: `${BASE_URL}environments/restaurant.jpg`,
    unlockSmokedRequired: UNLOCK_THRESHOLDS.restaurant,
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
    keyHint: '3',
    name: 'Parking Garage',
    sector: 'SECTOR 03 · SUB-LEVEL B2 DECK',
    vibe: 'Fluorescent · Raw Concrete',
    weather: '58°F · Stale Draft',
    risk: 'BLIND CAMERA',
    riskTone: 'success',
    image: `${BASE_URL}environments/parking-garage.jpg`,
    unlockSmokedRequired: UNLOCK_THRESHOLDS['parking-garage'],
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
    keyHint: '4',
    name: 'By a Dumpster',
    sector: 'SECTOR 04 · LOADING DOCK CORRAL',
    vibe: 'Floodlight · Rusted Steel',
    weather: '44°F · Night Mist',
    risk: 'SHIFT LEAD NEARBY',
    riskTone: 'error',
    image: `${BASE_URL}environments/dumpster.jpg`,
    unlockSmokedRequired: UNLOCK_THRESHOLDS.dumpster,
    lighting: {
      sky: 0x9ab0c7,
      ground: 0x24281e,
      sun: 0xffe0a3,
      sunIntensity: 3.6,
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
}: {
  current: SmokeEnvironment;
  onSelect: (id: EnvironmentId) => void;
  lifetimeSmoked?: number;
  unlockedEnvironments?: readonly EnvironmentId[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const effectiveUnlocked = unlockedEnvironments ?? getUnlockedEnvironments(lifetimeSmoked);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < ENVIRONMENTS.length) {
        onSelect(ENVIRONMENTS[index].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

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
            {collapsed ? `Show Spots (${ENVIRONMENTS.length})` : 'Minimize'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="env-deck-grid" role="radiogroup" aria-label="Environment options">
          {ENVIRONMENTS.map(env => {
            const active = env.id === current.id;
            const unlocked = effectiveUnlocked.includes(env.id) || lifetimeSmoked >= env.unlockSmokedRequired;
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
                  <span>{unlocked ? env.weather : `${env.weather} · Unlock @ ${env.unlockSmokedRequired} butts`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}


