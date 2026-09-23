import type { Game } from '../Game';

export type RewardType = 'cash' | 'doubleCash';

/**
 * Hook for rewarded ads in the mobile build. A future "Reklam izle" button shows the ad,
 * then calls grant(). Not exposed in the v1 UI.
 */
export function grant(type: RewardType, g: Game) {
  switch (type) {
    case 'cash':
      g.addMoney(Math.max(50, g.incomePerSecond() * 60));
      break;
    case 'doubleCash':
      g.cashMultiplierUntil = performance.now() + 60_000;
      break;
  }
}
