"""CPU evaluation of a JAX checkpoint against a frozen PyTorch reference."""
import argparse
import hashlib
import json
import math
import multiprocessing as mp
from pathlib import Path
import time

import numpy as np

from .export_checkpoint import export_checkpoint


def summary(pair_wins, solo_wins):
    # Each paired deal is ONE independent observation in [0,1]. A Hoeffding
    # interval is conservative but remains defined at boundaries and for n=1.
    def interval(values, baseline):
        values = np.asarray(values, dtype=float)
        rate = float(values.mean())
        margin = math.sqrt(math.log(40) / (2 * len(values)))
        low, high = max(0., rate-margin), min(1., rate+margin)
        return dict(win_rate=rate, ci95=[low, high], independent_deals=len(values),
                    baseline=baseline, verdict='better' if low > baseline else
                    'worse' if high < baseline else 'unclear')
    return dict(paired_2v2=interval(np.asarray(pair_wins)/2, .5),
                solo_1v3=interval(solo_wins, .25),
                interval_method='Hoeffding, per evaluation; paired games grouped by deal')


def evaluate(candidate, reference, deals, workers, seed_start):
    from benchmark import _init_worker, _play as solo_play
    from head_to_head import _play as paired_play
    candidate, reference = str(candidate), str(reference)
    paired_jobs = [(d, swap, candidate, reference)
                   for d in range(seed_start, seed_start + deals) for swap in (False, True)]
    # Disjoint deal seeds from the 2v2 schedule (which adds 1,000,000).
    solo_jobs = [(d, candidate, reference) for d in range(seed_start + 2_000_000, seed_start + 2_000_000 + deals)]
    with mp.get_context('spawn').Pool(workers, _init_worker, ([candidate, reference],)) as pool:
        paired = pool.map(paired_play, paired_jobs, chunksize=16)
        solo = pool.map(solo_play, solo_jobs, chunksize=16)
    return summary(np.array(paired).reshape(-1, 2).sum(axis=1), [x[0] for x in solo])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--reference', type=Path, default=Path('models/selfplay_v1.pt'))
    parser.add_argument('--deals', type=int, default=1000)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--seed-start', type=int, default=0)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if min(args.deals, args.workers) < 1 or args.seed_start < 0:
        parser.error('deals/workers must be positive; seed-start must be nonnegative')
    start = time.perf_counter()
    candidate = args.checkpoint.with_suffix('.pt')
    export_checkpoint(args.checkpoint, candidate)
    result = evaluate(candidate, args.reference, args.deals, args.workers, args.seed_start)
    with np.load(args.checkpoint, allow_pickle=False) as data:
        result['training_games'] = json.loads(str(data['metadata']))['stats']['games']
    result.update(checkpoint=str(args.checkpoint), reference=str(args.reference),
                  reference_sha256=hashlib.sha256(args.reference.read_bytes()).hexdigest(),
                  seed_start=args.seed_start, evaluation_seconds=time.perf_counter()-start)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
