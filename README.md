# big2-app

A Big 2 bot trained by self-play, and a web app to play against it, play with friends, and get move suggestions for a real game. The bot is small enough to run in the browser.

The web app in `web/` has playable vs bots, one-device vs friends, Best move and game review modes. Accounts and online play are not built yet. See `web/README.md` for running and deploying it.

## The model

`models/selfplay_v1.pt` is the current best model.

- 716K parameters, weights only (2.9 MB)
- Trained for 4,437,010 self-play games, about 6.75 hours on a MacBook CPU
- Picks a move by scoring every legal move with one network call and playing the highest score
- Full record of the training run, with the learning curve and speed: `docs/training/selfplay-v1.md`

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

The existing CPU trainer requires Python 3.12 and PyTorch 2. The experimental
JAX GPU workflow has separate dependencies; see below.

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

Train with the existing PyTorch CPU trainer:

```bash
python3 train_selfplay.py --hours 8
```

- Uses 6 actor processes by default (`--actors`).
- Saves `checkpoints/selfplay/model_<games>.pt` and `latest.pt` every 15 minutes and when it stops. Stop early with `pkill -INT -f train_selfplay.py`.
- Resumes from `checkpoints/selfplay/latest.pt` when it exists, otherwise starts from scratch. `models/selfplay_v1.pt` has no optimizer state. Its weights can initialize a new run with a fresh optimizer, but this CLI does not yet offer that option.
- `checkpoints/` is not committed. A new model only replaces `models/selfplay_v1.pt` if it beats it head-to-head.

## JAX GPU experiments

We now have an experimental end-to-end JAX GPU trainer, alongside simulation
and inference benchmarks. The shipped model was trained with PyTorch on CPU;
no JAX-trained checkpoint has replaced it.

Implemented in [`experiments/jax_big2/`](experiments/jax_big2/README.md):

- A fixed-shape game environment, checked against the Python rules and encodings.
- A random-policy environment benchmark.
- A configuration sweep using frozen best-model weights, plus a separate
  synthetic optimizer-throughput benchmark. Neither benchmark trains a new bot.
- An end-to-end synchronous self-play trainer with best-weight initialization,
  full checkpoints, resume, and export to the existing PyTorch evaluation tools.

On our AutoDL instance (NVIDIA vGPU-32GB, driver 550.120, Python 3.12.3):

```bash
python -m venv .venv-jax
source .venv-jax/bin/activate
python -m pip install 'jax[cuda12]' numpy pytest optax
JAX_PLATFORMS=cuda python -m pytest tests -q
JAX_PLATFORMS=cuda python -m experiments.jax_big2.sweep
```

After tests pass, start a five-minute integrated training check:

```bash
JAX_PLATFORMS=cuda python -m experiments.jax_big2.train \
  --hours 0.083333 --out checkpoints/jax-smoke
```

Defaults are 64 parallel games, candidate capacity 64, optimizer batch 1024 and
learning rate 3e-4. The [sweep results and verdict](docs/training/jax-sweep-results.md)
record why we chose these settings, including the timing fix and memory findings. See the [training guide](experiments/jax_big2/TRAINING.md) for
resume, background runs and export/evaluation. Integrated GPU training performance
and learning quality still need validation.

The repository includes `models/selfplay_v1.npz`, an export of the shipped
PyTorch weights, so running the sweep does not require PyTorch. Results are saved
to `results/policy-sweep.json`. On a Mac, use `JAX_PLATFORMS=cpu` for tests;
the sweep requires `--allow-cpu` for local smoke checks.

The first GPU environment-only test reached about **148,816 decisions/s** at
1,024 parallel games, versus 11,807 for one Python worker on the same cloud host.
That original run reported **12.6x simulation throughput**, not training speedup.
A subsequent sweep exposed compilation inside the timed section; benchmark v2
fixes this, and the original rates need confirmation.
See the [JAX experiment record and proposed training setup](docs/training/jax-experiments.md)
for results, limitations and next steps.

## Training opponents and evaluation

The existing trainer uses all-seat self-play: all four seats use recent copies
of the evolving model, refreshed every four games per actor, with 1% random
exploration. Smart and greedy are evaluation opponents; they do not generate
training games. Evaluation also includes learned models and paired head-to-head
matches, not just classical bots.

The JAX trainer initializes from `selfplay_v1` with a fresh optimizer and uses
all-seat self-play. First validate this baseline, then test mixing
in frozen historical opponents, starting with `selfplay_v1`, against that baseline.
This opponent pool is proposed, not implemented. Keep the frozen best model as
an evaluation reference and retain Smart/greedy checks for regressions. A better
score against one opponent alone is not enough to establish general improvement.

## Layout

| Path | Contents |
|---|---|
| `big2_ai/env/` | Game engine (`game.py`), move types and comparisons (`move_detector.py`), legal moves (`move_generator.py`), the model's state and move encoding (`selfplay_encoding.py`) |
| `big2_ai/agents/` | Test opponents: the Smart bot from Patwa 2026 (`smart_bot.py`) and a greedy bot (`greedy_bot.py`) |
| `big2_ai/models/selfplay_network.py` | The network |
| `big2_ai/training/selfplay.py` | Deep Monte Carlo trainer: actor processes play games, a learner trains on every decision labelled with that player's final result |
| `train_selfplay.py`, `benchmark.py`, `head_to_head.py` | Command line scripts |
| `scripts/` | Exports for the web app: model weights, test positions, and the label cut-off check |
| `models/` | The current best model in PyTorch and exported JAX/NumPy formats |
| `experiments/jax_big2/` | JAX environment, GPU trainer, checkpoint export, benchmarks and configuration sweep |
| `tests/` | Rule tests, JAX environment parity, and PyTorch/JAX score comparisons |
| `docs/training/` | Training run reports and their raw logs |
| `web/` | The web app (Next.js) |
| `docs/superpowers/` | Design documents and project plan |

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
