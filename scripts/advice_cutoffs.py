"""How often each move label appears for moves the Smart bot plays.

Plays games of 1 model against 3 Smart bots, scores every legal move at each
Smart bot decision, and labels the Smart bot's choice the way the web app does
(web/src/lib/model/advice.ts). Used to check that Blunder stays rare.

Run from the repo root: python3 scripts/advice_cutoffs.py
"""

import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from big2_ai.agents import select_action_smart_bot  # noqa: E402
from big2_ai.env import Big2Game, get_legal_moves  # noqa: E402
from big2_ai.env.selfplay_encoding import encode_moves, encode_state  # noqa: E402
from big2_ai.models.selfplay_network import SelfPlayNetwork  # noqa: E402
from big2_ai.training.selfplay import choose_move  # noqa: E402

CALIBRATION = [(-1.0, 0.013), (-0.7, 0.092), (-0.5, 0.188), (-0.3, 0.304), (-0.1, 0.435),
               (0.1, 0.542), (0.3, 0.614), (0.5, 0.792), (0.8, 0.952)]
CUTOFFS = [(0.02, "Good"), (0.05, "Inaccuracy"), (0.12, "Mistake")]
GAMES = 300


def win_chance(score):
    xs, ys = zip(*CALIBRATION)
    return float(min(0.99, max(0.01, np.interp(score, xs, ys))))


def label(drop):
    if drop <= 0:
        return "Best"
    for cutoff, name in CUTOFFS:
        if drop < cutoff:
            return name
    return "Blunder"


def main():
    torch.set_num_threads(1)
    model = SelfPlayNetwork()
    model.load_state_dict(torch.load("models/selfplay_v2.pt", map_location="cpu")["model_state_dict"])
    model.eval()
    counts = Counter()
    for seed in range(GAMES):
        game = Big2Game(seed=20_000 + seed)
        hero = seed % 4
        while not game.done:
            player = game.current_player
            if player == hero:
                game.step(choose_move(model, game, player)[0])
                continue
            legal = get_legal_moves(game, player)
            move = select_action_smart_bot(game, player)
            if len(legal) > 1:
                with torch.no_grad():
                    scores = model(torch.from_numpy(encode_state(game, player)).float().unsqueeze(0),
                                   torch.from_numpy(encode_moves(legal)).float()).reshape(-1).tolist()
                chosen = next(i for i, m in enumerate(legal) if sorted(m.cards) == sorted(move.cards))
                counts[label(win_chance(max(scores)) - win_chance(scores[chosen]))] += 1
            game.step(move)
    total = sum(counts.values())
    print(f"Smart bot decisions with a choice: {total} over {GAMES} games")
    for name in ["Best", "Good", "Inaccuracy", "Mistake", "Blunder"]:
        print(f"  {name:<10} {counts[name] / total * 100:5.1f}%")


if __name__ == "__main__":
    main()
