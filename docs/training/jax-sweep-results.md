# JAX configuration sweeps: results and verdict

Date: 2026-11-01. Results transcribed from the user's AutoDL terminal output.
These tests measure frozen-policy self-play rollout throughput and separate
synthetic optimizer throughput. They do not measure integrated training speed,
playing-strength improvements or cost efficiency.

## Verdict

Use **64 parallel games and candidate capacity 64** as the initial trainer
configuration. In the corrected sweep this achieved **149,176 decisions/s and
3,377 games/s**, 38.1% more decisions/s than batch 1024. Batch 128 was the next
fastest at 141,984 decisions/s. Increasing the batch to use more of the 32 GB
GPU did not improve throughput.

Keep **optimizer batch 1024, Adam learning rate 3e-4, gradient clipping 1.0,
float32/highest precision and 1% exploration** for the initial learning baseline.
Only the rollout batch/capacity choices were informed by the rollout sweep.
The other settings preserve the previous learning setup; the synthetic learner
benchmark does not establish optimal learning hyperparameters.

Initialize training from `selfplay_v1` with a fresh optimizer. First measure the
integrated trainer and evaluate its checkpoints; recheck rollout batches 64 and
128 with trajectory storage and learning included. Historical-opponent mixing
is a separate experiment, not something these sweeps tested.

## Setup and provenance

| Item | Value |
| --- | --- |
| Provider | AutoDL |
| GPU | NVIDIA vGPU-32GB, 32,760 MiB; underlying physical GPU model unknown |
| Driver / reported CUDA compatibility | 550.120 / 12.4 |
| Python / JAX | 3.12.3 / 0.12.0.1 |
| Platform | Linux 5.15.0-83-generic, x86_64, glibc 2.35 |
| Policy | Frozen `models/selfplay_v1.npz` in all four seats |
| Weight SHA-256 | `30e2ce49b5bb4939d3c551c0538786a4de44508f31053e840e07a8a59dc477f8` |
| Exploration / seed | 0.01 / 42 |
| Matmul precision | `highest`, float32 weights |

The source is pasted console output, not independently retrieved JSON files.
The commands saved JSON on the instance. No hourly price or full dependency
freeze was supplied. Timing uses device synchronization. Different game batch
sizes produce different deals; these are single-seed throughput tests, not
statistical comparisons of game outcomes.

## First sweep: timing bug found

The initial command was `JAX_PLATFORMS=cuda python -m experiments.jax_big2.sweep`:
64 steps per rollout, three timed repetitions, and the default nine combinations.

| Parallel games | Candidate capacity | Reported decisions/s | First timed repeat (s) | Later repeats (s) |
| --- | ---: | ---: | ---: | --- |
| 64 | 32 | 3,344 | 3.6094 | 0.03336, 0.03189 |
| 64 | 64 | 3,178 | 3.8047 | 0.03083, 0.03098 |
| 64 | 128 | 3,258 | 3.6927 | 0.03962, 0.03919 |
| 256 | 32 | 10,646 | 4.1745 | 0.23895, 0.20346 |
| 256 | 64 | 9,885 | 4.6974 | 0.13772, 0.13703 |
| 256 | 128 | 9,849 | 4.6383 | 0.17646, 0.17596 |
| 1024 | 32 | 24,649 | 5.6620 | 1.23712, 1.07718 |
| 1024 | 64 | 31,095 | 5.0628 | 0.62079, 0.63925 |
| 1024 | 128 | 30,235 | 5.0455 | 0.72840, 0.72884 |

**Do not use those aggregate rates or their apparent winner to select settings.**
A local reproduction showed that initial weakly typed state integers became
strongly typed after the first rollout, causing another JIT compilation inside
the first timed repeat. The first warmup had not covered that input signature.

Fix `95abfaa` made the state integers explicitly int32 and compiled executables
before timing. Timed calls cannot silently retrace. A regression test verifies
repeated execution for both random-policy and model-policy rollouts.

The later repeats suggested candidate capacity 64 was a useful compromise between
padding and rare full-action fallback. Capacity 32 overflowed about 0.17–0.20% of
decisions; capacity 64 about 0.0066–0.0163%; capacity 128 did not overflow in this
short run. These observations motivated the corrected sweep, but do not prove
capacity 64 is optimal across all policies and workloads.

## Corrected sweep: stable rollout timings

```bash
JAX_PLATFORMS=cuda python -m experiments.jax_big2.sweep \
  --batch-sizes 32 64 128 256 512 1024 \
  --capacities 64 --steps 512 --repeats 5 \
  --learner-batches --output results/policy-sweep-v2.json
```

Each configuration had one 512-step warmup and five measured 512-step blocks.
The reported version was `benchmark_version: 2`. Compilation plus warmup took
18.9–31.4 seconds per configuration, separate from the measurements below.

| Parallel games | Decisions/s | Games/s | Timed block range (s) | Overflow decisions | Max legal moves |
| --- | ---: | ---: | --- | ---: | ---: |
| 32 | 117,088 | 2,653 | 0.13837–0.14240 | 0.00732% | 127 |
| **64** | **149,176** | **3,377** | **0.21799–0.22132** | **0.00671%** | **127** |
| 128 | 141,984 | 3,226 | 0.45576–0.46669 | 0.00671% | 127 |
| 256 | 122,675 | 2,791 | 1.05863–1.08455 | 0.00824% | 127 |
| 512 | 121,853 | 2,775 | 2.12442–2.18680 | 0.00839% | 142 |
| 1024 | 108,012 | 2,459 | 4.79378–4.90430 | 0.00801% | 145 |

Mean legal moves were about four per decision. Capacity 64 is padding, not a
hard action limit: overflow triggers exact full-action scoring, so rare hands
with 127–145 legal moves remain playable without truncation.

## Memory findings

The exported model parameters occupied 2,863,108 bytes (~2.86 MB). State storage
was 53,998 bytes per lane. Compiler estimates from the corrected rollout sweep:

| Parallel games | State storage (MB) | Arguments + outputs + temporary buffers (MB) |
| --- | ---: | ---: |
| 32 | 1.73 | 26.58 |
| 64 | 3.46 | 50.29 |
| 128 | 6.91 | 98.56 |
| 256 | 13.82 | 194.25 |
| 512 | 27.65 | 337.89 |
| 1024 | 55.29 | 877.50 |

MB means decimal million bytes. Aliased buffers were reported as zero. These
compiler estimates are not total GPU memory usage, allocator reservations or a
measured process peak; state storage is already represented in the arguments and
outputs, so do not add that column again.

Low memory use is expected: the sweep keeps no trajectory/replay buffer and has
no live learner optimizer state during rollout timing. More available VRAM does
not imply that a larger batch will run faster. These results support optimizing
throughput rather than trying to fill memory; they do not identify a specific
compute, bandwidth or launch bottleneck without profiling.

## Synthetic learner sweep

The first run separately benchmarked 50 MSE/gradient-clip/Adam updates per batch,
starting from best-model weights with a fresh optimizer and resident synthetic
data. Warmup updates were discarded.

| Optimizer batch | Timed seconds | Samples/s | Final synthetic MSE |
| --- | ---: | ---: | ---: |
| 512 | 0.00918 | 2,787,675 | 0.14634 |
| 1024 | 0.01340 | 3,820,077 | 0.23011 |
| 2048 | 0.02162 | 4,735,581 | 0.26655 |
| 4096 | 0.03671 | 5,579,393 | 0.30989 |

Larger batches improved this synthetic throughput, but each measurement lasted
only 9–37 ms. Inputs are synthetic, there is no rollout/learner integration, and
losses across different batches do not measure bot quality. Retain batch 1024
initially. Confirm the actual collection/learning balance from the integrated
trainer's separate timing logs before changing the algorithm to chase throughput.

## Follow-up

The [trainer guide](../../experiments/jax_big2/TRAINING.md) uses these starting
settings. Its synchronous complete-game rounds, terminal-label construction,
shuffling, padded minibatches and optimizer updates differ from the continuous
frozen-policy sweep. Integrated GPU speed and playing strength remain unmeasured
at the time of this report. Evaluate against the frozen best model, Smart and
greedy before considering replacement of the shipped checkpoint.
