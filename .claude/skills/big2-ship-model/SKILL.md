---
name: big2-ship-model
description: Use when a trained Big 2 checkpoint (a JAX .npz from experiments/jax_big2/train.py or a PyTorch .pt from train_selfplay.py) might replace the model the app uses, when evaluating a checkpoint against the current best, or when web/src/lib/model/current.json, models/selfplay_vN.*, web/public/model/, positions.json fixtures or puzzles.json need regenerating after a model change.
---

# Ship a Big 2 model

One model powers Hard bots, hints, Best move, reviews, daily puzzles and online Hard bots, in the browser and on the server. `web/src/lib/model/current.json` names it and its parent. Every web loader, the service worker, the tests, `benchmark.py best` and the Python export scripts read that file through `web/src/lib/model/current.ts` and `big2_ai/models/current.py`.

Shipping a model means: prove it beats the current best, add it as new versioned files beside the old ones, point `current.json` at it, regenerate everything derived from it, and record the evidence.

## Rules

- **A new version gets new files.** Never overwrite `models/selfplay_vN.*` or `web/public/model/selfplay_vN.*` for a version that already exists. Old versions are frozen evaluation references; confirmation reports record their SHA-256.
- **Compare against the current best.** `experiments.jax_big2.evaluate` defaults `--reference` to v1. Always pass `--reference models/$CURRENT.pt`.
- **Use fresh seeds** for the confirmation run, outside every range already used (step 1 shows how to list them).
- **Puzzles are rescored, never regenerated.** `export_puzzles.py --rescore` keeps the 365 positions and updates only their best moves. Running it without `--rescore` replaces every day's puzzle.
- **Leave the `selfplay_v1` defaults in `experiments/` and `tests/` alone.** They are the frozen reference for reproducibility, not the app's model.
- **A changed network or encoding is not a promotion.** If `export_web_weights.py` fails its layer assertion, or `big2_ai/models/selfplay_network.py` or `big2_ai/env/selfplay_encoding.py` changed, stop and tell the user: `web/src/lib/model/network.ts` and `encoding.ts` must change too.

## Setup

Run everything from the repo root with `python3`.

```bash
CURRENT=$(python3 -c "from big2_ai.models.current import MODEL_NAME; print(MODEL_NAME)")
NEW=selfplay_v3                       # next unused number in models/
RUN=checkpoints/<run>                 # git-ignored; evidence is copied to docs in step 6
CANDIDATE=$RUN/model_<games>.npz
```

## 1. Gate: better than the current best

```bash
grep -ho '"seed_start": [0-9]*' docs/training/*/*.json* | sort -u   # seeds already used
python3 -m experiments.jax_big2.evaluate "$CANDIDATE" --reference "models/$CURRENT.pt" \
  --deals 10000 --workers 4 --seed-start <unused, e.g. 800000000> --output "$RUN/confirmation.json"
```

Passes only if `paired_2v2.verdict` and `solo_1v3.verdict` are both `"better"`. `"unclear"` is not a pass: report the numbers and stop. The run also writes `${CANDIDATE%.npz}.pt`.

A PyTorch candidate from `train_selfplay.py` cannot go through `evaluate`. Use `python3 head_to_head.py models/$CURRENT.pt <candidate.pt> --deals 10000` (needs `B better`) and `python3 benchmark.py <candidate.pt> --vs best --games 10000` (needs `better`). These use fixed seeds; say so in the report.

Then check the heuristic bots did not get easier to beat it:

```bash
python3 benchmark.py "${CANDIDATE%.npz}.pt" --vs smart greedy --games 5000 --workers 2 | tee "$RUN/candidate-heuristics.txt"
python3 benchmark.py best --vs smart greedy --games 5000 --workers 2 | tee "$RUN/baseline-heuristics.txt"
```

If the candidate's interval against either bot sits wholly below the current best's, that is a regression: show both and ask before going on.

## 2. Add the versioned weights

```bash
python3 -m experiments.jax_big2.export_checkpoint "$CANDIDATE" "models/$NEW.pt"
python3 - "$NEW" "$CURRENT" <<'EOF'
import sys
import numpy as np
import torch

new, parent = sys.argv[1:]  # parent = the model the run was initialized from
ck = torch.load(f"models/{new}.pt", map_location="cpu")
p = torch.load(f"models/{parent}.pt", map_location="cpu")
ck.update(model_name=new, parent_model=parent, additional_training_games=ck["games"],
          parent_training_games=p.get("parent_training_games", 0) + p["games"])
torch.save(ck, f"models/{new}.pt")
np.savez(f"models/{new}.npz", **{k: v.numpy() for k, v in ck["model_state_dict"].items()})
EOF
```

For a PyTorch candidate, first write `models/$NEW.pt` as `{"model_state_dict": ..., "games": ...}` taken from it, so no optimizer state is committed, then run the Python block.

## 3. Point the app at it

Edit `web/src/lib/model/current.json`: `"model"` becomes `$NEW`, `"parent"` becomes the model the run started from (usually `$CURRENT`). Nothing else names the model.

## 4. Regenerate what derives from the model

```bash
python3 scripts/export_web_weights.py       # web/public/model/$NEW.bin and .json
python3 scripts/export_web_fixtures.py      # web/src/lib/engine/__fixtures__/positions.json
python3 scripts/export_puzzles.py --rescore # web/public/puzzles.json best moves
python3 scripts/advice_cutoffs.py | tee "$RUN/advice.txt"
```

`advice.ts` keeps its v1-derived calibration unless the user asks to recalibrate. Update its calibration comment to name `$NEW`, and report the Blunder share from `advice.txt`.

## 5. Verify

```bash
git status --short
python3 -m pytest tests -q                  # CI does not run these
cd web && npm run lint && npm run typecheck && npm test && npm run build
```

`git status` must show `models/$NEW.{pt,npz}` and `web/public/model/$NEW.{bin,json}` as new, and `current.json`, `positions.json`, `puzzles.json` and `advice.ts` as modified. If any existing version's file shows as modified, a rule was broken: undo that file.

The web tests are the parity proof: `model.test.ts` checks the manifest names the current model and that all fixture scores match PyTorch within 1e-4, and `puzzle.test.ts` checks every puzzle's best move matches Python.

## 6. Record the evidence

- Write `docs/training/$NEW.md` with the sections of `docs/training/selfplay-v2.md`: Verdict, Fresh confirmation, Heuristic regression checks, Training and checkpoint history, Recommendation, Evidence and reproducibility, Promotion validation.
- Copy the raw files from `$RUN` into `docs/training/$NEW/`: `train.jsonl`, `evaluation.jsonl`, `confirmation.json`, both heuristics files, `training-analysis.json` if present, `advice.txt`.
- Add a "Superseded in the app by" line to the top of the previous model's report.
- Update the sentences that say which model is current: `grep -n "$CURRENT" README.md web/README.md experiments/jax_big2/*.md docs/training/jax-experiments.md`. Leave sentences about v1 as the frozen reference.

## 7. Ship

Branch `feat/ship-$NEW`. Commit the weights, `current.json` and regenerated assets together, then the docs separately. Open a PR whose test plan lists the confirmation verdicts, the heuristic numbers and the test results.

## Common mistakes

| Mistake | Effect |
| --- | --- |
| Evaluating with the default `--reference` | Proves the candidate beats v1, not the model it replaces |
| Reusing a seed range from an earlier evaluation | The candidate may have been selected on those deals, so the result is biased |
| Running `export_puzzles.py` without `--rescore` | Every day's puzzle changes for players |
| Overwriting the old version's files | Breaks the frozen reference and its recorded SHA-256 |
| Skipping `export_web_fixtures.py` | `model.test.ts` fails: fixture scores came from the old model |
| Committing the JAX `.npz` checkpoint instead of the weights-only `.npz` | Optimizer state lands in git; the committed `.npz` holds only the nine layer arrays |
