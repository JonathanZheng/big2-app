# JAX environment experiment

This is an isolated, exact-rule environment prototype, not a replacement trainer.
It tests whether batching simulation on a GPU is worth pursuing. The existing
PyTorch trainer and shipped weights are unchanged.

## What is implemented

- Pure JAX reset, legal-action mask, step, terminal rewards and 566-feature observations.
- All 1,665 subsets of each original 13-card hand (including pass); no action cap.
- Precomputed move types and comparison values per deal, with remaining cards
  represented by 13-bit masks. Action indices refer to the original deal.
- `jit`/`vmap` random-policy rollouts including reset and observation encoding.
- Differential tests against the production engine: complete games, legal sets,
  observations, winners, rewards, terminal behavior and subset classifications.

`step` assumes a legal action. Terminal states are absorbing, with no legal
actions; callers must reset before choosing another move. `from_deal` expects
a valid permutation of the deck. Rewards are zero until terminal.

## Local validation

In a Python 3.12 virtual environment, install `jax`, `numpy` and `pytest`:

```bash
python -m pip install jax numpy pytest
JAX_PLATFORMS=cpu python -m pytest tests -q
JAX_PLATFORMS=cpu python -m experiments.jax_big2.benchmark \
  --batch-sizes 1 16 64 --steps 128 --repeats 3 \
  --output /tmp/big2-jax-cpu.json
```

Explicit CPU selection avoids initializing an installed experimental Metal
plugin on macOS. JAX is optional: the new tests skip if it is not installed.

Initial Mac CPU smoke test, JAX 0.4.35, 128 steps x 3 repeats:

| Implementation | Decisions/s | Completed games/s |
| --- | ---: | ---: |
| Python, one worker | 18,428 | 249 |
| JAX, batch 1 | 338 | 4.4 |
| JAX, batch 16 | 1,563 | 21.6 |
| JAX, batch 64 | 1,874 | 25.9 |

These short measurements are not a controlled performance study. They show no
CPU benefit from this prototype. A subsequent AutoDL GPU test reached 148,816
decisions/s at batch 1,024; see the [experiment record](../../docs/training/jax-experiments.md).
The original training report's ~175 games/s includes model inference and learning
with multiple actors; it is not comparable to these environment-only rates.

## Cloud GPU test

Use a Linux NVIDIA GPU machine with this repository copied or checked out.
Start with one GPU. The commands below do not provision or shut down a machine.
Choose a provider, hourly budget and time limit before renting one.

```bash
nvidia-smi
python3 -m venv .venv-jax
source .venv-jax/bin/activate
python -m pip install --upgrade pip
# AutoDL driver 550.120: use CUDA 12 wheels.
python -m pip install 'jax[cuda12]' numpy pytest optax
JAX_PLATFORMS=cpu python -m pytest tests -q
JAX_PLATFORMS=cuda python -m pytest tests/test_jax_env.py -q
JAX_PLATFORMS=cuda python -m experiments.jax_big2.benchmark \
  --require-gpu --batch-sizes 1 16 64 256 1024 \
  --steps 512 --repeats 5 --baseline-seconds 15 \
  --output /tmp/big2-jax-gpu.json
python -m pip freeze > /tmp/big2-jax-packages.txt
```

Per the [JAX installation guide](https://docs.jax.dev/en/latest/installation.html),
CUDA 13 requires an NVIDIA driver >=580 and GPU compute capability >=7.5.
Our AutoDL driver 550.120 uses `jax[cuda12]` (driver >=525), as above.
Use `jax[cuda13]` only on hardware and drivers that meet its requirements.
`--require-gpu` fails if the benchmark is running on CPU.

Save the JSON, package versions, `nvidia-smi` output, machine CPU count and hourly
price, then stop the rented instance using the provider's controls. The script
reports compilation/warmup separately and synchronizes every timed rollout, as
recommended by [JAX's benchmarking guide](https://docs.jax.dev/en/latest/201/profiling.html).
Initial reset is included in warmup; subsequent episode resets are timed.

## How to decide whether to build the trainer

Compare Python and JAX on the same cloud host. Use decisions/s as well as games/s
because random games differ in length. Repeat runs for stable measurements.
The Python baseline is one worker; also consider CPU parallelism and hourly cost
before declaring GPU cost savings.

This implementation deliberately favors completeness over efficiency. Masking
1,665 candidates wastes work when few are legal. Also, `vmap` of the reset
conditional can evaluate both branches, including candidate classification for
lanes that do not need a new deal. Profile reset and move masking before scaling.
Do not run the full neural network on all padded candidates without measuring
the cost; compact/bucket candidates with explicit overflow handling instead.

GPU simulation has shown a throughput benefit. The best-policy sweep below
now measures batched inference and a separate synthetic learner; GPU results
for that sweep are pending. The next implementation is an end-to-end trainer
with identical network, observations, rewards and exploration. Keep rollout, inference, terminal-return assignment and optimizer
updates on device; porting only the learner leaves Python simulation overhead.
Check converted weights against PyTorch scores and export checkpoints for the
existing evaluation scripts. Measure end-to-end games/s, cost per million
decisions and win rate against the shipped model before replacing the trainer.

The existing model plateaued around 3.5M games. Faster simulation can make
algorithm experiments cheaper, but does not itself promise better playing strength.

## Best-model configuration sweep

Export locally where PyTorch and the shipped checkpoint are available:

```bash
python -m experiments.jax_big2.export
```

This writes `models/selfplay_v1.npz` plus 476 reference PyTorch scores from
real game positions. The remote sweep requires no PyTorch installation.
The exported weights retain float32 values exactly. Future training can start
from these weights with a fresh optimizer; the shipped file has no Adam state.

On the GPU host:

```bash
python -m pip install optax
JAX_PLATFORMS=cuda python -m pytest tests -q
JAX_PLATFORMS=cuda python -m experiments.jax_big2.sweep
```

The default quick sweep tests 64/256/1024 parallel games against candidate
capacities 32/64/128. Each configuration warms up for 64 decisions per lane,
then times three further 64-step blocks. All seats use frozen `selfplay_v1`
weights with 1% random exploration. This is not training and produces no new
checkpoint. Candidate overflow triggers exact full-action scoring for affected
lanes; moves are never discarded. Both padding and fallback affect throughput.
Ties use the fixed subset order, which can differ from the Python generator.

Float32 matmul precision is set to `highest` to establish a conservative numerical
baseline ([JAX precision documentation](https://docs.jax.dev/en/latest/201/precision.html)).
Tests compare JAX scores with independent PyTorch outputs, exercise overflowing
hands, and check legal actions under greedy and exploratory selection.

A separate microbenchmark runs 50 MSE/gradient-clip/Adam updates on resident
synthetic data for batches 512/1024/2048/4096. It starts each size from the same
best weights and fresh optimizer, then discards the result. These figures exclude
rollout storage, reward assignment, shuffling and transfers. They are not an
end-to-end training-speed or learning-quality measurement. Larger optimizer
batches change optimization behavior; retain the old 1024 unless a subsequent
learning experiment justifies changing it. Learning rate remains 3e-4.

Results are saved after every configuration to `results/policy-sweep.json`, with
model hash, precision, timing repetitions and candidate overflow frequency.
Compilation/warmup is separate. After the first sweep, rerun the top configurations
with `--steps 256 --repeats 5` (select sizes using `--batch-sizes` and
`--capacities`; use `--learner-batches` with no values to skip optimizer tests).
Prefer a smaller configuration if throughput is within run-to-run variation.

The old trainer used all-seat self-play, refreshing actor weights every four
games. Smart and greedy were evaluation opponents, not training opponents.
The first JAX training comparison should preserve this setup before experimenting
with an opponent pool or other algorithm changes.

For measured GPU results and the proposed historical-opponent experiment, see
[the JAX experiment record](../../docs/training/jax-experiments.md).
