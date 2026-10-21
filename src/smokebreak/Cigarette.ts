// 3D cigarette mesh assembly, burning rod/ash geometry updates, ember glow flicker, and stubbed-out butt factory.

import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  type MeshStandardMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector3,
} from 'three';

/** Real king-size proportions, in cm. */
export const RADIUS = 0.39;
export const FILTER = 2.7;
export const ROD = 5.7;
/** Paper left above the filter when it is finished. */
export const STUB = 0.8;
export const BURNABLE = ROD - STUB;
const CHAR = 0.14;
const EMBER = 0.16;

export interface Materials {
  filter: Material[];
  paper: MeshStandardMaterial;
  char: MeshStandardMaterial;
  ember: MeshStandardMaterial;
  ash: MeshStandardMaterial;
  /** The blackened, crushed-out end of a butt. */
  stubbed: MeshStandardMaterial;
}

export class Cigarette {
  readonly group = new Group();
  private readonly paper: Mesh;
  private readonly char: Mesh;
  private readonly ember: Mesh;
  private readonly ash: Mesh;
  private readonly halo: Sprite;
  private readonly light = new PointLight(0xff6a20, 0, 0, 2);
  private readonly embers: MeshStandardMaterial;

  constructor(materials: Materials, glow: Texture) {
    const filter = new Mesh(new CylinderGeometry(RADIUS, RADIUS, FILTER, 40).translate(0, FILTER / 2, 0), materials.filter);
    this.paper = new Mesh(new CylinderGeometry(RADIUS, RADIUS, 1, 40, 1, true).translate(0, 0.5, 0), materials.paper);
    this.paper.position.y = FILTER;
    this.char = new Mesh(new CylinderGeometry(RADIUS * 1.004, RADIUS * 1.004, CHAR, 40, 1, true).translate(0, CHAR / 2, 0), materials.char);
    this.ember = new Mesh(new CylinderGeometry(RADIUS * 0.9, RADIUS * 0.99, EMBER, 40).translate(0, EMBER / 2, 0), materials.ember);
    this.ash = new Mesh(new CylinderGeometry(RADIUS * 0.8, RADIUS * 0.96, 1, 40).translate(0, 0.5, 0), materials.ash);
    for (const mesh of [filter, this.paper, this.char, this.ember, this.ash]) mesh.castShadow = true;
    this.embers = materials.ember;
    this.halo = new Sprite(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    this.halo.renderOrder = 11;
    this.group.add(filter, this.paper, this.char, this.ember, this.ash, this.halo, this.light);
  }

  /** Shortens the rod by `burned` cm and grows `ash` cm of ash past the ember. */
  set(burned: number, ash: number) {
    const rod = ROD - burned;
    this.paper.scale.y = rod;
    (this.paper.material as MeshStandardMaterial).map!.repeat.y = rod / ROD;
    const end = FILTER + rod;
    this.char.position.y = end - 0.02;
    this.ember.position.y = end + CHAR - 0.06;
    this.ash.position.y = end + CHAR + EMBER - 0.08;
    this.ash.scale.y = Math.max(0.02, ash);
    this.ash.visible = ash > 0.01;
    const embers = this.ember.position.y + EMBER * 0.6;
    this.halo.position.set(0, embers, 0);
    this.light.position.set(0, embers + 0.3, 0);
  }

  setGlow(glow: number) {
    const flicker = 0.92 + Math.random() * 0.08;
    this.embers.emissiveIntensity = (1.4 + glow * 4) * flicker;
    this.halo.scale.setScalar((1.1 + glow * 1.6) * flicker);
    (this.halo.material as SpriteMaterial).opacity = 0.45 + glow * 0.5;
    this.light.intensity = (3 + glow * 14) * flicker;
  }

  /** The burning end in world space, where the sidestream leaves. */
  tip() {
    const top = this.ash.visible ? this.ash.position.y + Math.min(this.ash.scale.y, 0.4) : this.ember.position.y + EMBER;
    return this.group.localToWorld(new Vector3(0, top, 0));
  }

  ashCenter(length: number) {
    return new Vector3(0, this.ash.position.y + length / 2, 0);
  }
}

/** A stubbed-out butt: the filter and a crumpled, charred stub, in the cigarette's own frame. */
export function makeButt(materials: Materials) {
  const butt = new Group();
  const filter = new Mesh(new CylinderGeometry(RADIUS, RADIUS, FILTER, 32).translate(0, FILTER / 2, 0), materials.filter);
  const paper = materials.paper.clone();
  paper.map = materials.paper.map!.clone();
  paper.map.repeat.y = STUB / ROD;
  // Smoke-stained and scorched toward the burnt end.
  paper.color.set(0xd2c3a2);
  const stub = new Mesh(new CylinderGeometry(RADIUS * 0.93, RADIUS, STUB, 32, 1, true).translate(0, STUB / 2, 0), paper);
  stub.position.y = FILTER;
  stub.scale.set(1, 1, 0.82);
  // Crushed out: a squashed, blackened end bent a little off the axis.
  const crushed = new Mesh(new CylinderGeometry(RADIUS * 0.5, RADIUS * 0.93, 0.22, 24).translate(0, 0.11, 0), materials.stubbed);
  crushed.position.y = FILTER + STUB - 0.02;
  crushed.rotation.z = (Math.random() - 0.5) * 0.7;
  crushed.scale.set(1.15, 1, 0.6);
  for (const mesh of [filter, stub, crushed]) mesh.castShadow = mesh.receiveShadow = true;
  butt.add(filter, stub, crushed);
  return butt;
}
