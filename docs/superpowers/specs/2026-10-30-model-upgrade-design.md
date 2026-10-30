# Big 2 Model Upgrade Design

> Written in the original `big2` repo, where this work was carried out. The old model, the old trainer and the rule-based bot were not ported to `big2-app`; the result of this design is `models/selfplay_v1.pt`. See `docs/superpowers/plans/2026-10-30-big2-plan.md` for the outcome.

## Intent

Build a Big 2 bot that is genuinely strong under the house rules, small enough to run inside a browser, and whose progress is measured honestly.

The current best checkpoint (`checkpoints/big2_model.pt`) only looked good because of noisy evaluation. Measured properly it wins 25.8% against 3 greedy bots (400 games, which is chance), 30.6% against 3 rule-based bots (160 games, margin about 7%) and 21.7% against 3 Smart bots (2,000 games, margin about 1.8%). Training was also throttled by the rule-based opponent, which takes about 6.7 seconds per game.

## Goals

1. The engine follows the house straight rules below.
2. Evaluation is trustworthy: random seats, 2,000 games per matchup, 95% margins reported.
3. The new model clearly beats the Smart bot, beats the old model, and each new "best" beats the previous best head-to-head.
4. The model stays at or below about 1M parameters, so the web app can run it in TypeScript.

## Non-goals

- Training against bots. Bots are test opponents only.
- Cloud or GPU training. At this model size the M3 CPU is as fast as the GPU for training and much faster for picking moves.
- JAX or a rewritten game engine.
- Porting the model into the web app (that comes with the app rebuild; this work only has to produce a checkpoint that can be exported).

## Anti-goals

- Choosing a "best" model from a single noisy evaluation.
- Breaking the old model's evaluation path (it remains a test opponent and uses the old 167-number state).

## House rules: straights

Lowest to highest:

3-4-5-6-7 < 4-5-6-7-8 < ... < 10-J-Q-K-A < J-Q-K-A-2 < 2-3-4-5-6 < A-2-3-4-5

- Two straights of the same run: the suit of the highest card decides (for runs containing a 2, that is the suit of the 2).
- Straight flushes use the same order.
- Q-K-A-2-3 and K-A-2-3-4 are not straights.
- The opening move must still contain the 3 of diamonds, so 2-3-4-5-6 and A-2-3-4-5 become legal openers.

All other rules stay as they are (five-card order: straight < flush < full house < four of a kind plus kicker < straight flush).

## Training method

Deep Monte Carlo self-play, in the style of DouZero.

- **Self-play only.** All four seats use the current model. Every decision from every seat becomes a training example labelled with that player's final reward.
- **Reward:** the existing margin reward (winner 0.8 to 1.0, losers -0.8 to -1.0 depending on cards left).
- **Exploration:** fixed epsilon of 0.01 (DouZero's setting) instead of decaying from 0.9.
- **Batched move scoring:** all legal moves are scored in one forward pass.
- **Actors and learner:** several actor processes play games continuously with a recent copy of the weights and send examples to a learner process. Each example is used once, in shuffled chunks. No replay buffer statistics, no target network, no critic.

### State (all public or own information, 566 numbers, all 0 or 1)

| Feature | Size |
|---|---|
| My hand | 52 |
| Cards not yet seen (not in my hand, not played) | 52 |
| Cards played by each opponent (next, across, previous) | 3 x 52 |
| Current trick to beat (zeros when leading) | 52 |
| Who played the current trick, relative to me (me, next, across, previous) | 4 |
| Passes since the trick was played (0, 1, 2) | 3 |
| Each opponent's card count, one-hot 1 to 13 | 3 x 13 |
| Last 4 moves, cards only (passes are zeros) | 4 x 52 |

### Move (61 numbers)

52 card slots plus a one-hot move type (pass, single, pair, triple, straight, flush, full house, four of a kind, straight flush).

### Network

An MLP on state plus move: 627 inputs, hidden layers 512, 512, 256, one output. About 715K parameters.

## Evaluation

A benchmark script plays 2,000 games per matchup, with the evaluated agent in a random seat against three copies of the opponent, and reports win rate, a 95% margin, and average score (winner gets the losers' cards left, each loser loses their own cards left).

Opponents:

1. Smart bot (Patwa 2026, Algorithm 2). Target: beat the paper's Monte Carlo result of 32.5%, then clearly more.
2. The old model `checkpoints/big2_model.pt`, through its original 167-number state.
3. The previous best new checkpoint. A checkpoint only becomes the new best if it beats the previous best head-to-head with the margin above 25%.

Greedy and rule-based bots are dropped from routine evaluation.

## Success criteria

- Win rate against 3 Smart bots above 32.5% with the 95% margin clear of 25%.
- Win rate against 3 copies of the old model clear of 25%.

## Where things live

| Piece | Location |
|---|---|
| Straight rules | `big2_ai/env/move_detector.py`, `big2_ai/env/move_generator.py` |
| Rule tests | `tests/test_straights.py` (pytest) |
| New state and move encoding | `big2_ai/env/selfplay_encoding.py` |
| Network | `big2_ai/models/selfplay_network.py` |
| Actors and learner | `big2_ai/training/selfplay.py` |
| Entry points | `train_selfplay.py` (runs until stopped or `--hours`, resumes from the latest checkpoint), `benchmark.py` |
| Checkpoints and log | `checkpoints/selfplay/` |

## Builder decisions

These were left to the builder (Claude) and can be revisited:

- Network size and layer widths, learning rate (Adam, 3e-4) and batch size (1,024).
- Including the last 4 moves as flat features rather than an LSTM. An LSTM over a longer history is a later experiment, kept only if it wins head-to-head.
- Keeping the margin reward rather than switching to the paper's card-count score.
- The old trainer (`big2_ai/training/trainer.py`, `league.py`, the PTIE critic and the LSTM model) is left untouched as legacy code; the new pipeline lives in new files. Deleting the legacy code is a separate decision.
- PPO is not part of this work. It is the next experiment if Monte Carlo self-play stops improving.
