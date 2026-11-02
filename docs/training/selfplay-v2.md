# Training run and promotion: selfplay_v2

Analysis date: 2026-11-01. Candidate: `model_10072256.npz` / `.pt`.
Promoted weights: `models/selfplay_v2.pt` and `models/selfplay_v2.npz`.
Reference: the unchanged `models/selfplay_v1.pt`.

The app now loads `web/public/model/selfplay_v2.bin` in the worker, fallback
and server. Versioned asset URLs and service-worker cache `big2-v2` separate
the new weights from cached v1 assets.

## Verdict

The final JAX checkpoint demonstrates a modest improvement against the frozen
v1 model in both tested opponent compositions. A larger fresh-deal confirmation
places both win rates above their equal-strength baselines using the evaluator's
conservative per-comparison confidence bounds. This supports promoting it as `selfplay_v2`; it does not establish universal superiority or that it is
the best checkpoint from the run. The app and Python `best` alias now select v2; the original v1 files remain intact.

## Fresh confirmation against v1

Command:

```bash
python3 -m experiments.jax_big2.evaluate \
  checkpoints/jax-full/model_10072256.npz \
  --deals 10000 --workers 4 --seed-start 700000000 \
  --output checkpoints/jax-full/confirmation_10072256.json
```

| Comparison | Candidate win rate | 95% interval | Equal baseline | Verdict |
| --- | ---: | --- | ---: | --- |
| Two candidate seats vs two v1 seats | 52.97% | 51.61–54.33% | 50% | Better |
| One candidate seat vs three v1 seats | 27.16% | 25.80–28.52% | 25% | Better |

The paired test uses 10,000 independent deals, each played twice with sides
swapped (20,000 games). The solo test uses another 10,000 games, rotating the
candidate seat. Both models act greedily. The seed ranges are separate from the
online training-evaluation schedules. Intervals use Hoeffding bounds over deals;
the paired test does not count its two games as independent observations.
These are per-comparison intervals, not a simultaneous confidence guarantee.
Runtime was about 266 seconds on the Mac, with heuristic checks running alongside.

## Heuristic regression checks

Both models were evaluated locally on the same 5,000 deals per opponent using
`benchmark.py --vs smart greedy --games 5000 --workers 2`.

| Opponent | v1 | Candidate | Change |
| --- | ---: | ---: | ---: |
| Three Smart bots | 46.1% ±1.4 pp | 46.7% ±1.4 pp | +0.6 pp |
| Three greedy bots | 56.5% ±1.4 pp | 55.8% ±1.4 pp | −0.7 pp |

Values are rounded as printed by the benchmark; margins are its approximate
95% per-model binomial margins. These small differences do not show an obvious
regression or clear improvement against the heuristic suite. Overlapping
individual intervals are not a formal paired test of the difference; per-deal
outcomes were not retained by this benchmark. The fresh v1 results, rather than
old README numbers from different sample sizes, are the comparison baseline.

## Training and checkpoint history

The NPZ metadata records 10,072,256 additional JAX games, 433,789,717 decisions,
472,265 optimizer updates and 157,379 rounds. These counters exclude the original
v1 training embedded in the starting weights. Cumulative recorded time is
3,915 seconds (~65.3 minutes), including evaluation/checkpoint overhead but not
compilation. The one-hour continuation's last logged rate was 2,564 games/s
including evaluation pauses; the earlier evaluation-free smoke run sustained
about 2,810 games/s.

The 20 online evaluations consumed about 291 seconds. Descriptive averages of
successive five-checkpoint groups were:

| Group | Paired win rate | Solo win rate |
| --- | ---: | ---: |
| First five | 50.24% | 25.70% |
| Next five | 52.20% | 25.84% |
| Next five | 53.19% | 26.80% |
| Last five | 52.79% | 26.52% |

This suggests modest improvement followed by flattening, not steady unbounded
progress. These group means combine different policies and are not pooled
confidence estimates for the final checkpoint. The highest online paired point
estimate was 53.6% at 7,843,328 games; that noisy difference does not establish
that checkpoint as better than the final one.

Sampled round losses remained finite (0.263–0.423, median 0.341). Median sampled
collection time was 20.1 ms, compared with 1.74 ms learning. Median active-lane
fraction was 60.7% because completed games wait for the round's longest game.
These are periodically sampled rounds, not full time-weighted profiler statistics.
Collection/scheduling remains a more plausible optimization target than larger
optimizer batches. Loss alone is not evidence of playing strength.

## Recommendation

Retain the full optimizer checkpoint locally as a validated improvement
against v1. There is no need to discard pure self-play: it produced a measurable,
though modest, gain here. Do not assume that another long identical run will
continue improving at the same rate; the online results appear to flatten.

For the next learning experiment, compare pure self-play with historical-opponent
mixing from the same starting checkpoint and with matched budgets. Retain v1 as
an immutable evaluation reference even if it later enters a training pool. Keep
some other historical checkpoints out of that pool for evaluation if available.
The promotion retains v1 and exports v2 weights plus regenerated Python/browser
fixtures. All 365 daily puzzle positions are preserved and their best moves are
rescored with v2; stored historical answers/labels are not rewritten. The existing
v1-derived score-to-advice calibration remains in use, so this change does not
claim newly calibrated win probabilities. The app displays evaluations and labels,
not those internal probabilities. A 300-game Smart-decision check gives 45.4% Best,
27.8% Good, 11.1% Inaccuracy, 8.1% Mistake and 7.6% Blunder. Recalibration is a
follow-up; rescored puzzles are not guaranteed to retain the original selection gap.

## Evidence and reproducibility

Raw reports live in [selfplay-v2/](selfplay-v2/): `train.jsonl`, `evaluation.jsonl`,
`confirmation.json`, `baseline-heuristics.txt`, `candidate-heuristics.txt`, and
`training-analysis.json`. Paths inside these historical outputs refer to the
original checkpoint filenames at evaluation time.

The committed model files are weights-only. `games: 10072256` counts additional
JAX games; the parent v1 was trained for 4,437,010 games. Metadata records both
counts rather than treating the new run as training from scratch. Full JAX
optimizer checkpoints remain in Git-ignored `checkpoints/`.

Rebuild app assets from the repository root:

```bash
python3 scripts/export_web_weights.py
python3 scripts/export_web_fixtures.py
python3 scripts/export_puzzles.py --rescore
python3 scripts/advice_cutoffs.py
```

The trainer and benchmark experiments retain v1 as their default initial weights
and frozen evaluation reference for reproducibility. To warm-start a future run
from the new best weights, use `--weights models/selfplay_v2.npz`; to resume the
actual optimizer state, use the original full checkpoint with `--resume`.

## Promotion validation

- Python: 36 tests pass, including JAX/Python rule, reward and checkpoint tests.
- Web: 129 tests pass; 7 live Supabase integration tests are skipped without a
  configured running app. All 301 regenerated score fixtures match PyTorch and
  all 365 puzzle best moves match Python. 43 puzzle answers changed; positions
  were checked unchanged.
- The promoted PT, NumPy export and browser binary were compared exactly against
  the validated checkpoint's tensors. The v1 SHA-256 still matches the reference
  used by the confirmation evaluation.
- `npm run lint` passes. `npx next build --webpack` passes, including TypeScript
  and page generation. Default Turbopack build was blocked by this environment's
  worker-port permission restriction after an initial Google Fonts network failure.
- Live preview checks for worker/fallback, online Hard bots and offline cache
  upgrade remain deployment-review tasks; no live production deployment or merge
  was performed by this promotion change.
