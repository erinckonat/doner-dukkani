interface Tween { t: number; dur: number; fn: (k: number) => void; done?: () => void }

export const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
export const easeOutQuart = (k: number) => 1 - Math.pow(1 - k, 4);

export class Tweens {
  private list: Tween[] = [];

  add(dur: number, fn: (k: number) => void, done?: () => void) {
    this.list.push({ t: 0, dur, fn, done });
    fn(0);
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) {
        this.list.splice(i, 1);
        tw.done?.();
      }
    }
  }
}
