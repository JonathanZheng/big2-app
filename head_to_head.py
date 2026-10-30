"""Head-to-head between self-play checkpoints: 2 copies of A vs 2 copies of B.

Each deal is played twice: once with a random seating, once with A and B
swapped into each other's seats, so deal luck cancels. 50% = equal.
Example: python3 head_to_head.py models/selfplay_v1.pt checkpoints/selfplay/latest.pt
"""

import argparse
import itertools
import math
import multiprocessing as mp
import random

from big2_ai.env import Big2Game
from benchmark import _init_worker, _agents


def _play(args):
    """Returns 1 if A's side wins, 0 if B's side wins."""
    deal, swap, a, b = args
    seats = ["A", "A", "B", "B"]
    random.Random(deal).shuffle(seats)
    if swap:
        seats = ["B" if s == "A" else "A" for s in seats]
    names = {"A": a, "B": b}
    game = Big2Game(seed=1_000_000 + deal)
    while not game.done:
        player = game.current_player
        game.step(_agents[names[seats[player]]](game, player))
    return int(seats[game.winner] == "A")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+")
    parser.add_argument("--deals", type=int, default=2000)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    with mp.get_context("spawn").Pool(args.workers, _init_worker, (args.models,)) as pool:
        for a, b in itertools.combinations(args.models, 2):
            jobs = [(d, s, a, b) for d in range(args.deals) for s in (False, True)]
            wins = sum(pool.map(_play, jobs, chunksize=16))
            n = len(jobs)
            rate = wins / n
            margin = 1.96 * math.sqrt(rate * (1 - rate) / n)
            verdict = "A better" if rate - margin > 0.5 else "B better" if rate + margin < 0.5 else "unclear"
            print(f"A={a.split('/')[-1]} vs B={b.split('/')[-1]}: A side wins {rate * 100:.1f}% "
                  f"+/- {margin * 100:.1f}% over {n} games ({verdict})", flush=True)


if __name__ == "__main__":
    main()
