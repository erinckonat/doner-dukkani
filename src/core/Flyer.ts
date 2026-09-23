import * as THREE from 'three';

interface Flight {
  from: THREE.Vector3;
  fromQ: THREE.Quaternion;
  anchor: THREE.Object3D;
  local: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  onDone?: () => void;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * Moves objects along an arc to a slot on a (possibly moving) anchor, then parents them there.
 * Calling fly() on an object already in flight retargets it from where it is now.
 */
export class Flyer {
  private flights = new Map<THREE.Object3D, Flight>();

  constructor(private scene: THREE.Scene) {}

  fly(
    obj: THREE.Object3D,
    anchor: THREE.Object3D,
    local: THREE.Vector3,
    opts: { dur?: number; arc?: number; onDone?: () => void } = {},
  ) {
    obj.updateWorldMatrix(true, false);
    const from = new THREE.Vector3();
    const fromQ = new THREE.Quaternion();
    obj.getWorldPosition(from);
    obj.getWorldQuaternion(fromQ);
    if (obj.parent !== this.scene) this.scene.attach(obj);
    this.flights.set(obj, {
      from, fromQ, anchor, local: local.clone(), t: 0,
      dur: opts.dur ?? 0.28, arc: opts.arc ?? 0.8, onDone: opts.onDone,
    });
  }

  cancel(obj: THREE.Object3D) {
    this.flights.delete(obj);
  }

  update(dt: number) {
    for (const [obj, f] of this.flights) {
      f.t += dt / f.dur;
      const k = Math.min(1, f.t);
      const e = 1 - (1 - k) * (1 - k);
      f.anchor.updateWorldMatrix(true, false);
      tmpV.copy(f.local);
      f.anchor.localToWorld(tmpV);
      obj.position.lerpVectors(f.from, tmpV, e);
      obj.position.y += Math.sin(k * Math.PI) * f.arc;
      f.anchor.getWorldQuaternion(tmpQ);
      obj.quaternion.slerpQuaternions(f.fromQ, tmpQ, e);
      if (k >= 1) {
        this.flights.delete(obj);
        f.anchor.add(obj);
        obj.position.copy(f.local);
        obj.quaternion.identity();
        f.onDone?.();
      }
    }
  }
}
