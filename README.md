# big2-app

A Big 2 bot trained by self-play, and (soon) a web app to play against it and to get move suggestions for a real game. The bot is small enough to run in the browser.

The web app is not built yet. This repo currently holds the game engine, the trainer, the test opponents and the trained model.

## The model

`models/selfplay_v1.pt` is the current best model.

- 716K parameters, weights only (2.9 MB)
- Trained for 4,437,010 self-play games, about 6.75 hours on a MacBook CPU
- Picks a move by scoring every legal move with one network call and playing the highest score

Win rate as 1 player against 3 copies of each opponent. 2,000 games each, random seats; 25% is break-even.

| Opponent | Win rate |
|---|---|
| 3 Smart bots | 46.2% ±2.2% |
| 3 greedy bots | 55.5% ±2.2% |

For reference, Patwa 2026 reports 32.5% against the Smart bot for the same training method and 43.5% for its best model (PPO).

## Rules

Standard Big 2 for 4 players, 13 cards each.

- Card order: 3 < 4 < ... < K < A < 2. Suit order: ♦ < ♣ < ♥ < ♠.
- The holder of the 3♦ starts, and the first move must contain it.
- Moves: singles, pairs, triples and five-card hands.
- Five-card hands, lowest to highest: straight, flush, full house, four of a kind plus one card, straight flush.
- Straights, lowest to highest: 3-4-5-6-7 < 4-5-6-7-8 < ... < 10-J-Q-K-A < J-Q-K-A-2 < 2-3-4-5-6 < A-2-3-4-5. Between two straights of the same run, the suit of the highest card decides (the 2 when the run has one). Straight flushes use the same order. Q-K-A-2-3 and K-A-2-3-4 are not straights.

## Setup

Requires Python 3.12 and PyTorch 2.

```bash
pip3 install -r requirements.txt
python3 -m pytest tests/
```

## Usage

Benchmark an agent against 3 copies of each opponent:

```bash
python3 benchmark.py best --vs smart greedy
python3 benchmark.py checkpoints/selfplay/latest.pt --vs smart best
```

Agents are `smart`, `greedy`, `best` (`models/selfplay_v1.pt`) or a path to a checkpoint.

Compare two models head-to-head (2 copies of each, random seating, every deal played twice with the sides swapped; 50% means equal):

```bash
python3 head_to_head.py models/selfplay_v1.pt checkpoints/selfplay/latest.pt
```

Train:

```bash
python3 train_selfplay.py --hours 8
```

- Uses 6 actor processes by default (`--actors`).
- Saves `checkpoints/selfplay/model_<games>.pt` and `latest.pt` every 15 minutes and when it stops. Stop early with `pkill -INT -f train_selfplay.py`.
- Resumes from `checkpoints/selfplay/latest.pt` when it exists, otherwise starts from scratch. `models/selfplay_v1.pt` has no optimizer state, so it can't be resumed from.
- `checkpoints/` is not committed. A new model only replaces `models/selfplay_v1.pt` if it beats it head-to-head.

## Layout

| Path | Contents |
|---|---|
| `big2_ai/env/` | Game engine (`game.py`), move types and comparisons (`move_detector.py`), legal moves (`move_generator.py`), the model's state and move encoding (`selfplay_encoding.py`) |
| `big2_ai/agents/` | Test opponents: the Smart bot from Patwa 2026 (`smart_bot.py`) and a greedy bot (`greedy_bot.py`) |
| `big2_ai/models/selfplay_network.py` | The network |
| `big2_ai/training/selfplay.py` | Deep Monte Carlo trainer: actor processes play games, a learner trains on every decision labelled with that player's final result |
| `train_selfplay.py`, `benchmark.py`, `head_to_head.py` | Command line scripts |
| `models/` | The current best model |
| `tests/` | Rule tests |
| `docs/superpowers/` | Design document and project plan |

## How the model works

- **Input:** 566 numbers describing what the player can see, including:
  - their own hand
  - cards not yet seen
  - the cards each opponent has played
  - the move to beat and who played it
  - passes since that move
  - each opponent's card count
  - the last 4 moves

  Each candidate move adds 61 numbers: its cards and its type.
- **Network:** 3 hidden layers (512, 512, 256) that output one score per candidate move.
- **Training:** all 4 seats are played by the current model. After each game, every decision is labelled with that player's result: the winner gets 0.8 to 1.0, and losers get -0.8 to -1.0 depending on cards left. The network learns to predict this. It plays a random move 1% of the time.

## References

- Patwa 2026, *Self-Play Reinforcement Learning under Imperfect Information in Big 2* (arXiv 2605.28863): the Smart bot, and the reference results quoted above.
- Zha et al. 2021, *DouZero*: the Deep Monte Carlo self-play method.

## License

MIT
