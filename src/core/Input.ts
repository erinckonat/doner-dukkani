const JOY_RADIUS = 56;
const DEAD_ZONE = 0.12;

/** Floating touch/mouse joystick plus WASD/arrow keys. Screen up maps to world -z. */
export class Input {
  private keys = new Set<string>();
  private joyId = -1;
  private ox = 0;
  private oy = 0;
  private jx = 0;
  private jz = 0;
  onFirstGesture?: () => void;

  constructor(canvas: HTMLCanvasElement, private joy: HTMLElement, private knob: HTMLElement) {
    addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      this.onFirstGesture?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      this.onFirstGesture?.();
      if (this.joyId !== -1) return;
      this.joyId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.joy.style.left = `${e.clientX}px`;
      this.joy.style.top = `${e.clientY}px`;
      this.joy.classList.add('on');
      this.setKnob(0, 0);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_RADIUS) {
        dx = (dx / d) * JOY_RADIUS;
        dy = (dy / d) * JOY_RADIUS;
      }
      this.setKnob(dx, dy);
      this.jx = dx / JOY_RADIUS;
      this.jz = dy / JOY_RADIUS;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = -1;
      this.jx = this.jz = 0;
      this.joy.classList.remove('on');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private setKnob(x: number, y: number) {
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  get move(): { x: number; z: number } {
    const k = this.keys;
    let x = this.jx;
    let z = this.jz;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) z -= 1;
    if (k.has('s') || k.has('arrowdown')) z += 1;
    const m = Math.hypot(x, z);
    if (m < DEAD_ZONE) return { x: 0, z: 0 };
    if (m > 1) return { x: x / m, z: z / m };
    return { x, z };
  }
}
