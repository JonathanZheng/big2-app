# JAX Deep Monte Carlo training

The first end-to-end trainer uses all-seat self-play initialized from the shipped
`selfplay_v1.npz` weights. Default settings follow the corrected AutoDL sweep:
64 games per round, candidate capacity 64, float32/highest precision, Adam at
3e-4, batch 1024, gradient clipping at 1.0 and 1% exploration. Historical-opponent
mixing remains a separate future experiment. The [sweep results and verdict](../../docs/training/jax-sweep-results.md)
document the measured rollout configuration choice and its limits.

## AutoDL start and resume

From the repository root, activate the existing JAX virtual environment. Install
`jax[cuda12] numpy optax pytest` if setting up a fresh environment on driver 550.120.
No PyTorch dependency is needed for JAX training.

```bash
source /root/big2-jax-venv/bin/activate
JAX_PLATFORMS=cuda python -m pytest tests -q
# First check integrated GPU throughput and finite loss for five minutes.
JAX_PLATFORMS=cuda python -m experiments.jax_big2.train \
  --hours 0.083333 --out checkpoints/jax-smoke
```

Compilation and discarded warmup updates happen before the training clock starts.
The runtime limit is checked between rounds; the final round and checkpoint save
can extend it. Ctrl+C or SIGTERM requests a stop at the next completed round and
saves the consistent model, optimizer and random key. A forced kill cannot save.

Resume the smoke run for another hour:

```bash
JAX_PLATFORMS=cuda python -m experiments.jax_big2.train \
  --resume checkpoints/jax-smoke/latest.npz \
  --out checkpoints/jax-smoke --hours 1
```

For a run that survives closing the browser terminal:

```bash
mkdir -p checkpoints/jax-selfplay
nohup env JAX_PLATFORMS=cuda python -u -m experiments.jax_big2.train \
  --out checkpoints/jax-selfplay --hours 1 \
  > checkpoints/jax-selfplay/console.log 2>&1 &
echo $!
```

Record that PID; use `kill -INT PID` to request a saved stop. `nohup` does not keep
a powered-off cloud instance alive. The script does not stop or release AutoDL
resources when finished.

A new run refuses to overwrite an existing `latest.npz` unless `--resume` is
supplied. Resume restores saved algorithm settings (including environment count
and batch size), even if different values appear on the command line. Runtime,
output location and logging/checkpoint intervals remain command-line settings.
To compare configurations, start fresh output directories from the same initial
weights; do not compare a fresh model with a resumed, further-trained model.

## Data and training semantics

Each round deals one game per lane and freezes the actor policy for the entire
round. Completed lanes become inactive while remaining games finish. The learner
then uses every valid decision once, in randomized order, including a masked
partial final minibatch. Each target is the acting player's true final margin
reward. Observations and moves stay as uint8 on device until minibatch scoring.
No intermediate rewards, truncated returns or bootstrapped labels are used.

Games have a conservative 208-turn bound: at most 52 card-playing turns, with at
most three passes between them. The trainer refuses to learn from a round that
fails to terminate within the bound. Invalid buffer positions are excluded from
loss and gradient normalization. Candidate overflow scores all actions for the
affected lane instead of dropping legal moves.

This synchronous implementation differs from the old asynchronous CPU trainer:
policies refresh after each whole round, not every four games per actor; examples
are shuffled within a round rather than chunks of 16,384; the last partial
minibatch is used rather than discarded. Idle lanes and learner updates can
reduce throughput relative to the continuous frozen-policy sweep. These are
intentional first-version tradeoffs, not a claim of bit-identical old training.

## Files and monitoring

- `config.json`: algorithm settings, initial weight hash and initial library versions.
- `train.jsonl`: cumulative games, samples, updates and rounds, plus session rates
  and the most recent round's sample-weighted MSE. Low loss is not a strength metric.
- `latest.npz`: atomic full checkpoint, saved every 15 minutes and on exit.
- `model_<games>.npz`: corresponding numbered full checkpoints.

Checkpoint NPZ files contain weights, Adam state, the PRNG key, configuration and
counters. Saving occurs only after a complete round has been learned; there are
no pending trajectories to lose on resume. Restore is tested to reproduce the
next update on the same software/backend. Cross-version/backend bitwise identity
is not guaranteed; record `python -m pip freeze` with each run. Keep separate
runs in separate directories. The shipped best model is never overwritten.

## Export and evaluate

Download an NPZ checkpoint through Jupyter and evaluate on the Mac with the
existing PyTorch installation, or install PyTorch in a separate cloud evaluation
environment. Export does not require JAX initialization:

```bash
python -m experiments.jax_big2.export_checkpoint \
  checkpoints/jax-smoke/latest.npz checkpoints/jax-smoke/latest.pt
python benchmark.py checkpoints/jax-smoke/latest.pt --vs best smart greedy
python head_to_head.py models/selfplay_v1.pt checkpoints/jax-smoke/latest.pt
```

The exported `.pt` contains weights and metadata for the existing evaluation
scripts; it is not a resumable PyTorch optimizer checkpoint. Resume JAX from the
original `.npz`. Evaluate the untouched starting model too, and confirm improvements
with fresh games before replacing `models/selfplay_v1.pt`.

## Validation status

Local CPU validation: 36 tests pass, including full-game target comparison with
the Python engine, masked-example isolation and exact next-update restoration.
Short CLI runs cover training, checkpoint saving, resume and evaluation export.
Integrated GPU performance and learning quality remain to be measured on AutoDL.

## Training with periodic evaluation against selfplay_v1

The trainer can evaluate at session start (including a resumed smoke checkpoint),
every N additional training games, and at normal session completion. Enable it
explicitly; the default remains no in-run evaluation. The reference is copied to
`evaluation/reference.pt` and its hash is recorded. Resuming with a different
reference in the same output directory is rejected.

Install CPU PyTorch in the cloud virtual environment for evaluation only:

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
JAX_PLATFORMS=cuda python -m experiments.jax_big2.train \
  --resume checkpoints/jax-smoke/latest.npz \
  --out checkpoints/jax-full --hours 1 \
  --eval-every-games 500000 --eval-deals 1000 --eval-workers 4
```

The new directory preserves the original smoke checkpoint. This continues its
weights and optimizer; omit `--resume` to start again from the shipped best
weights with a fresh optimizer. Neither option starts from random weights.
Use a new directory for a new run. On later resume, pass the evaluation flags
again: they are runtime options, not restored algorithm settings.

Each evaluation saves a numbered NPZ and exported PT checkpoint and plays:

- 1,000 paired deals, each played twice with the two sides swapped: two new-model
  seats versus two reference seats. Equal-strength baseline: 50%.
- 1,000 separate deals: one new-model seat versus three reference seats, rotating
  the new model's seat. Equal-strength baseline: 25%.

Both policies act greedily during evaluation. Deals vary between checkpoints and
are separate from the training PRNG. Results print to the console, append to
`evaluation.jsonl`, and save under `evaluation/eval_<games>.json`.

The CPU evaluation runs in a subprocess with CUDA hidden and **pauses training**.
The session's `--hours` clock and logged aggregate training rates include these
pauses, so compare them accordingly with evaluation-free runs. Evaluation can
extend the deadline at the end; Ctrl+C during training requests a saved stop
without starting another evaluation. An evaluation failure stops the run with
the pre-evaluation checkpoint preserved. No automatic promotion or early stopping
is performed. A background run can use the same `nohup` pattern shown above.

Confidence intervals use a conservative Hoeffding bound over independent deals.
The paired comparison treats each two-game pair as one observation, not two
independent samples. At 1,000 deals the half-width is about 4.3 percentage points.
`better` means the lower bound exceeds the appropriate 50% or 25% baseline.
These are per-evaluation intervals, not a simultaneous guarantee over repeatedly
selected checkpoints. Confirm a promising model with more fresh deals and retain
Smart/greedy regression checks before deployment.

## Recommendation on old-model training opponents

Keep pure all-seat self-play for the first monitored continuation. The old model
is the frozen evaluation reference. This establishes whether the current method
actually improves from the warm start.

Then compare a separate 80% current-self-play / 20% historical-opponent run from
the same starting checkpoint with matched learner-sample and wall-time budgets.
Including old policies may help avoid forgetting, but a single frozen opponent
can also encourage narrow exploitation; the ratio is not validated for Big 2.
Opponent mixing is not implemented in this trainer yet.

If mixing helps and the learner consistently beats v1, reduce its sampling weight
and add stronger historical snapshots rather than immediately deleting it from
the pool. Always retain an immutable v1 evaluation reference. Require repeated
fresh-deal evidence and checks against other styles; do not remove an opponent
or promote a checkpoint based on a single win-rate spike.
