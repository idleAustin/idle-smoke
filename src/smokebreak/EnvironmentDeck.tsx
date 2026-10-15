import { useEffect, useState } from 'react';

export type EnvironmentId = 'alleyway' | 'restaurant' | 'parking-garage' | 'dumpster';

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
}: {
  current: SmokeEnvironment;
  onSelect: (id: EnvironmentId) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
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
            return (
              <button
                key={env.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`env-spot-card ${active ? 'active' : ''}`}
                onClick={e => {
                  e.currentTarget.blur();
                  onSelect(env.id);
                }}
              >
                <div className="env-spot-thumb">
                  <img src={env.image} alt={env.name} loading="eager" />
                  <span className="env-spot-kbd">{env.keyHint}</span>
                  {active && <span className="env-spot-active-tag">ACTIVE</span>}
                </div>
                <div className="env-spot-body">
                  <strong>{env.name}</strong>
                  <span>{env.weather}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

