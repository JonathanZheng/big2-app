# JAX GPU experiments and next training run

Status as of 2026-11-01: the environment, configuration sweep and experimental
end-to-end JAX trainer are implemented. Historical-opponent mixing is not.
The current shipped model remains the PyTorch-trained `selfplay_v1`.

The detailed [sweep results and verdict](jax-sweep-results.md) include both policy
sweeps, the timing correction, memory estimates and synthetic optimizer results.

## Measured environment throughput

The user ran the benchmark on AutoDL and supplied the terminal output. Hardware
was reported as NVIDIA vGPU-32GB (32,760 MiB); the underlying GPU model is not
known. Driver 550.120, CUDA compatibility 12.4, Python 3.12.3, JAX 0.12.0.1,
Linux 5.15.0-83-generic. Use the CUDA 12 JAX installation for this driver.

Command: `python -m experiments.jax_big2.benchmark --require-gpu --batch-sizes
1 16 64 256 1024 --steps 512 --repeats 5 --baseline-seconds 15
--output results/gpu-benchmark.json`, with `JAX_PLATFORMS=cuda`.

| Implementation | Decisions/s | Completed games/s | Compilation + warmup (s) |
| --- | ---: | ---: | ---: |
| Python, one worker | 11,807 | 159.8 | — |
| JAX GPU, batch 1 | 1,066 | 14.2 | 4.16 |
| JAX GPU, batch 16 | 14,547 | 195.3 | 5.33 |
| JAX GPU, batch 64 | 49,791 | 667.4 | 5.46 |
| JAX GPU, batch 256 | 112,106 | 1,515.1 | 5.99 |
| JAX GPU, batch 1,024 | 148,816 | 2,015.8 | 8.13 |

These are random-policy simulation rates, including legal moves, observations
and ongoing episode resets. Device work was synchronized, but the original
benchmark could compile a second specialization inside the timed section (see
below). Treat these as historical uncorrected measurements and rerun with v2. They do not include neural inference or learning. The 12.6x
ratio compares a batched GPU with one Python worker, not an optimized parallel
CPU trainer. Cost efficiency is unmeasured. Raw result JSON remains on the user's
instance; this table transcribes their supplied output.

The initial 28 tests passed on the GPU in 12.41 seconds. With the policy sweep
added, 31 tests passed locally on CPU, including 476 independently generated
PyTorch score fixtures and overflow-action checks. The user subsequently supplied GPU results for the best-policy sweep; see the
timing correction below. GPU validation of the additional policy tests has not
been reported separately.

## Configuration sweep

See [setup and commands](../../experiments/jax_big2/README.md). The committed
`models/selfplay_v1.npz` contains the current best model's float32 weights.

The sweep tests 64/256/1024 concurrent games and 32/64/128 candidate padding
sizes. Overflow uses exact full-action scoring for affected lanes. All four
players use the same frozen best model with 1% exploration. It reports throughput,
repeat timings and legal-action counts. A separate synthetic microbenchmark
measures MSE, gradient clipping and Adam at batches 512/1024/2048/4096.
No new trained checkpoint is produced.

Use the quick sweep to shortlist settings, then rerun the top configurations
with longer rollouts. Keep model precision and the seed fixed when comparing.
Learner microbenchmarks omit rollout buffers, return assignment and shuffling;
measure combined training before making final hardware-efficiency claims.
Retain optimizer batch 1024 and learning rate 3e-4 for the initial learning
baseline. Faster large batches do not establish better learning.

## How to use the existing best model

There are three separate roles:

| Role | Proposed use |
| --- | --- |
| Initialization | Start the new learner from `selfplay_v1` weights, with a fresh optimizer. |
| Evaluation | Keep an immutable `selfplay_v1` reference and test new checkpoints against it. |
| Training opponent | In a separate experiment, include a frozen copy in an opponent pool. |

The weights-only file cannot restore the old optimizer or resume its exact
training state. The current PyTorch CLI resumes full checkpoints from its output
directory, but does not expose a best-model warm-start option. The JAX sweep
and trainer load the exported best weights. The trainer starts a fresh optimizer
unless explicitly resuming a full JAX checkpoint.

## Proposed opponent comparison

First implement and validate all-seat self-play initialized from the best model.
This preserves the previous method while changing the execution framework.
Then compare it against a historical-opponent mixture with the same initial
weights, algorithm and evaluation schedule.

A reasonable first experimental mixture is:

- 80% of games: all four seats use the current learner policy.
- 20% of games: one randomly seated learner plays against three frozen opponents
  sampled from a small history pool. Start the pool with `selfplay_v1`, then add
  spaced checkpoints while retaining the original reference.

This ratio is a starting hypothesis, not a tuned Big 2 setting. Historical
opponents may help prevent forgetting and cycling, but training exclusively
against one fixed bot risks specializing to its weaknesses. Such mixtures are
still a form of self-play. Historical policies have been used in prior systems;
[OpenAI Five](https://openai.com/index/openai-five/) describes an 80/20 latest/past
mixture. Its result does not establish the right ratio for four-player Big 2.

For the proposed mixed games, train on the learner-controlled seats' decisions;
do not automatically treat frozen opponents' decisions as current-policy Monte
Carlo targets. Their later actions follow a different policy. Keep policy versions
fixed within a game and label each learner decision with that player's terminal
reward. In all-current games, use decisions from all four seats, as before.
This changes the number of usable training decisions per game, so report both
learner samples and elapsed time when comparing runs.

## Evaluation and model selection

Use the frozen best model as the main progress reference, while retaining Smart
and greedy as regression tests. Learned opponents and classical bots test
different behavior; beating one does not imply beating all others.

- Benchmark one candidate against three copies of `best`, `smart` and `greedy`
  with randomized seats. Symmetric identical policies have a 25% win baseline.
- Also run the existing paired two-versus-two comparison against `selfplay_v1`
  (50% baseline). This evaluates a different opponent composition.
- If historical checkpoints become training opponents, keep some checkpoints
  out of the pool for evaluation, and always use fresh evaluation deals.
- Report uncertainty, learner samples, wall time and cost. Confirm a selected
  checkpoint on fresh games to reduce selection bias from repeatedly testing.

Do not replace the shipped model based on lower loss or raw throughput. Require
convincing head-to-head improvement and inspect regressions across the suite.
The original run plateaued around 3.5M games; more simulation alone is not
evidence that the method will improve further.


## Best-policy sweep: timing correction and GPU memory

The first AutoDL policy sweep used 64 steps and three repeats. Every configuration
had a first timed repeat of 3.6–5.7 seconds, followed by much shorter repeats.
Local diagnosis reproduced a second JIT compilation: initial trick metadata and
winner integers were weakly typed, but became strongly typed after a rollout.
The aggregate throughput ranking therefore included compilation and should not
be used to pick a configuration. The environment-only benchmark shared this risk.

Benchmark version 2 gives those state fields explicit int32 types and compiles
an executable before warmup/timing. Repeated calls use that executable directly;
a signature mismatch raises rather than silently recompiling. A regression test
checks repeated policy and random rollouts through the same compiled executable.

For orientation only, rates computed from the final two repeats of the supplied
policy run were:

| Parallel games | Candidate capacity | Approximate decisions/s |
| --- | ---: | ---: |
| 64 | 32 | 125,550 |
| 64 | 64 | 132,543 |
| 64 | 128 | 103,135 |
| 256 | 64 | 119,264 |
| 1024 | 64 | 104,022 |

These are short, post-hoc estimates, not corrected benchmark results. They suggest
capacity 64 and a smaller batch may outperform batch 1024. Confirm with v2,
including intermediate batches:

```bash
JAX_PLATFORMS=cuda python -m experiments.jax_big2.sweep \
  --batch-sizes 32 64 128 256 512 1024 \
  --capacities 64 --steps 512 --repeats 5 \
  --learner-batches --output results/policy-sweep-v2.json
```

Low GPU memory use is expected. The model has about 716K float32 parameters
(~2.9 MB), and this sweep does not store rollout trajectories or a replay buffer.
Available VRAM does not indicate whether compute, kernel dispatch, or memory
bandwidth limits throughput. Maximize sustained useful decisions/s, leaving room
for actual training buffers, rather than filling the device for its own sake.

The sweep now reports resident state/parameter bytes and compiler estimates for
argument, output, temporary and aliased buffers. These estimates are not total
process/device memory or allocator reservation. Future training memory also
includes optimizer state, gradients, activations and stored trajectories.

The reported synthetic learner rates were 2.79M–5.58M samples/s, but each timed
sample lasted only 9–37 ms on synthetic resident data. They suggest rollout
collection deserves attention first; confirm with longer optimizer runs and an
integrated trainer before declaring the actual bottleneck. Retain batch 1024 as
the learning baseline even if larger optimizer batches score better in isolation.


## Corrected sweep and first trainer

The user's v2 run used capacity 64, 512 steps and five timed repeats. Repeats
were consistent after the compilation fix:

| Parallel games | Decisions/s | Games/s |
| --- | ---: | ---: |
| 32 | 117,088 | 2,653 |
| 64 | 149,176 | 3,377 |
| 128 | 141,984 | 3,226 |
| 256 | 122,675 | 2,791 |
| 512 | 121,853 | 2,775 |
| 1024 | 108,012 | 2,459 |

Batch 64 is the first trainer's default, with capacity 64 and optimizer batch
1024. At batch 64, overflow affected 0.0067% of decisions; compiler argument,
output and temporary buffer estimates totaled about 50 MB. These figures are
frozen-policy rollout results, not integrated training rates or total device memory.

The [training guide](../../experiments/jax_big2/TRAINING.md) describes the
implemented synchronous rounds, terminal return assignment, checkpoint restore
and PyTorch export. All 34 local CPU tests pass. The next step is a short AutoDL
training run, followed by checkpoint evaluation against the starting model,
Smart and greedy. Recheck batches 64 and 128 with the actual training workload
before a long run. No claim of improved playing strength has been established.
