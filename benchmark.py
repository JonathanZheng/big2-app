"""Benchmark an agent: 1 seat for the agent, 3 seats for copies of an opponent.

Agents:
    smart         Smart heuristic bot (Patwa 2026)
    greedy        Greedy bot
    best          models/selfplay_v1.pt, the current best model
    <path>.pt     A self-play checkpoint

Examples:
    python3 benchmark.py checkpoints/selfplay/latest.pt --vs smart best
    python3 benchmark.py checkpoints/selfplay/model_A.pt --vs checkpoints/selfplay/model_B.pt
"""

import argparse
import math
import multiprocessing as mp
import time

import torch

from big2_ai.env import Big2Game
from big2_ai.agents import select_action_greedy_bot, select_action_smart_bot
from big2_ai.models.selfplay_network import SelfPlayNetwork
from big2_ai.training.selfplay import choose_move

BEST_MODEL_PATH = "models/selfplay_v1.pt"

_agents = {}


def _load_agent(spec: str):
    if spec == "smart":
        return select_action_smart_bot
    if spec == "greedy":
        return select_action_greedy_bot
    if spec == "best":
        spec = BEST_MODEL_PATH
    model = SelfPlayNetwork()
    model.load_state_dict(torch.load(spec, map_location="cpu")["model_state_dict"])
    model.eval()
    return lambda game, player: choose_move(model, game, player)[0]


def _init_worker(specs):
    torch.set_num_threads(1)
    for spec in specs:
        _agents[spec] = _load_agent(spec)


def _play(args):
    """Game `seed` with the hero in seat seed % 4. Returns (won, score)."""
    seed, hero, opponent = args
    game = Big2Game(seed=seed)
    seat = seed % 4
    while not game.done:
        player = game.current_player
        agent = _agents[hero] if player == seat else _agents[opponent]
        game.step(agent(game, player))
    if game.winner == seat:
        return True, sum(len(h) for h in game.hands)
    return False, -len(game.hands[seat])


def benchmark(hero: str, opponents, games: int, workers: int):
    with mp.get_context("spawn").Pool(workers, _init_worker, ([hero] + list(opponents),)) as pool:
        for opponent in opponents:
            start = time.time()
            results = pool.map(_play, [(seed, hero, opponent) for seed in range(games)], chunksize=16)
            win = sum(r[0] for r in results) / games
            score = sum(r[1] for r in results) / games
            margin = 1.96 * math.sqrt(win * (1 - win) / games)
            verdict = "better" if win - margin > 0.25 else "worse" if win + margin < 0.25 else "unclear"
            print(f"vs 3x {opponent}: win {win * 100:5.1f}% +/- {margin * 100:.1f}% "
                  f"({verdict}), avg score {score:+.2f}  [{time.time() - start:.0f}s]", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Benchmark a Big 2 agent")
    parser.add_argument("hero", help="Agent to evaluate")
    parser.add_argument("--vs", nargs="+", default=["smart", "best"], help="Opponents")
    parser.add_argument("--games", type=int, default=2000)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    print(f"{args.hero}: {args.games} games per opponent, random seats, 25% = break-even")
    benchmark(args.hero, args.vs, args.games, args.workers)


if __name__ == "__main__":
    main()
