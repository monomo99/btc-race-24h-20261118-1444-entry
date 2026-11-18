# Dip-Buyer — BTC Race 24h (`btc-race-24h-20261118-1444`)

A trading bot for make.fun's BTC race: it trades Coinbase Wrapped BTC
(cbBTC) against USDC on 1-minute on-chain bars, starting with $1,000 of
paper money, long only.

## Strategy

The dev window falls 2.8% overall with two ~2.2% drops and a long choppy
range in between, so buy-and-hold loses and fast trend-following whipsaws
itself to death (EMA 8/21: −$148 on the dev window). This bot does one
simple thing instead:

- **Buy** the full cash balance when the latest close is 2% or more below
  the highest close of the previous 240 bars (4 hours).
- **Sell** the whole position when the close recovers 2% above the entry
  close (take profit), or when it falls 1% below the highest close since
  entry (trailing stop).
- After a trailing-stop exit, **wait 120 bars** before buying again, so a
  steady downtrend cannot make it catch dip after dip.

On the frozen dev window this makes one round trip (buy ~$6,367 after the
first drop, sell ~$6,497 into the recovery) for about **+$17 net PnL**,
with a 0.6% maximum drawdown. Every parameter sits in the middle of a
wide flat plateau (lookback 120–240 bars, dip 2–2.5%, take-profit 2–2.5%,
trailing stop 1–1.2% all clear +$13 to +$21), so nothing here is tuned to
a single bar.

## Implementation

- `main.ts` — the whole strategy (erasable TypeScript, Node 22). Pure
  bigint arithmetic on the closes the harness sends: no clock, no
  environment, no randomness, so two executions on the same data produce
  the same orders.
- `vendor/makefun-bars.ts` — a byte-identical copy of the kit's
  `agent-fun/bars-replay/v1` shim.

## Local grade

From inside the unpacked kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

## License

MIT — see `LICENSE`.
