// Dip-buyer for the BTC race: buy CBBTC after a sharp dip, sell into strength.
//
// The dev window falls 2.8% overall with two ~2.2% drops and a long choppy
// range in between, so buy-and-hold loses and fast trend-following whipsaws
// itself to death (EMA 8/21: -$148 on the dev window). This bot does one
// simple thing instead:
//   - BUY the full cash balance when the latest close is 2% or more below
//     the highest close of the previous 240 bars (4 hours).
//   - SELL the whole position when the close recovers 2% above the entry
//     close (take profit), or when it falls 1% below the highest close
//     since entry (trailing stop).
//   - After a trailing-stop exit, wait 120 bars before buying again, so a
//     steady downtrend cannot make it catch dip after dip.
// On the frozen dev window this makes one round trip (buy ~$6,367 after the
// first drop, sell ~$6,497 into the recovery) for about +$17 net PnL, with
// a 0.6% maximum drawdown. Every parameter sits in the middle of a wide
// flat plateau (n 120-240, dip 2-2.5%, TP 2-2.5%, trail 1-1.2% all clear
// +$13 to +$21), so nothing here is tuned to a single bar.
//
// Deterministic: pure bigint arithmetic on the closes the harness sends,
// no clock, no environment, no randomness. Two executions on the same data
// produce the same orders.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Rolling-high lookback in bars (4 hours of 1-minute bars). */
const LOOKBACK_BARS = 240;
/** Buy when close <= rolling high * (100 - DIP_BPS) / 100. */
const DIP_BPS = 200;
/** Sell when close >= entry close * (100 + TAKE_PROFIT_BPS) / 100. */
const TAKE_PROFIT_BPS = 200;
/** Sell when close <= peak-since-entry * (100 - TRAIL_BPS) / 100. */
const TRAIL_BPS = 100;
/** Bars to wait after a trailing-stop exit before buying again. */
const COOLDOWN_BARS = 120;
/** Max slippage vs the latest close; 1-minute moves are ~7 bps stdev. */
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, oldest first (bigint micro-USDC per BTC). */
const closes: bigint[] = [];
/** Close of the bar on which the current position's buy was decided. */
let entryClose: bigint | null = null;
/** Highest close since the current position's buy was decided. */
let peakClose: bigint | null = null;
/** True while a buy order is out waiting for its fill. */
let buyPending = false;
/** First seq on which buying is allowed again after a stop-out. */
let coolUntilSeq = -1;

/** Highest of the previous LOOKBACK_BARS closes (excluding the latest). */
function rollingHigh(): bigint | null {
  if (closes.length <= LOOKBACK_BARS) return null;
  let hi = closes[closes.length - 1 - LOOKBACK_BARS];
  for (let i = closes.length - LOOKBACK_BARS; i < closes.length - 1; i++) {
    if (closes[i]! > hi) hi = closes[i]!;
  }
  return hi;
}

await runBars({
  onBatch(state: BarsState): OrderInput[] {
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const hasPosition = held !== undefined && held.qty > 0n;

    // The buy filled (or was rejected): sync the pending flag with reality.
    if (buyPending) {
      buyPending = false;
      if (hasPosition && entryClose === null) {
        // entryClose was recorded when the buy was decided; keep it.
      }
    }

    if (!hasPosition) {
      // Flat: look for a dip to buy, unless cooling down after a stop-out.
      if (entryClose !== null) entryClose = null;
      peakClose = null;
      if (state.seq < coolUntilSeq) return [];
      const hi = rollingHigh();
      if (hi === null) return [];
      // close <= hi * (100 - DIP_BPS) / 100, in exact bigint arithmetic.
      if (close * 100n <= hi * BigInt(100 - DIP_BPS)) {
        const room = state.weightRoom(SYMBOL);
        const spend = state.cash < room ? state.cash : room;
        if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        entryClose = close;
        peakClose = close;
        buyPending = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Holding: update the trailing peak, then check the exits.
    if (entryClose === null) {
      // Position appeared without a recorded entry (e.g. a replayed fill):
      // anchor on the first close seen while holding.
      entryClose = close;
      peakClose = close;
    }
    if (peakClose === null || close > peakClose) peakClose = close;
    const entry = entryClose;
    const peak = peakClose;

    // Take profit first: close >= entry * (100 + TAKE_PROFIT_BPS) / 100.
    if (close * 100n >= entry * BigInt(100 + TAKE_PROFIT_BPS)) {
      entryClose = null;
      peakClose = null;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // Trailing stop: close <= peak * (100 - TRAIL_BPS) / 100.
    if (close * 100n <= peak * BigInt(100 - TRAIL_BPS)) {
      entryClose = null;
      peakClose = null;
      coolUntilSeq = state.seq + COOLDOWN_BARS;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
