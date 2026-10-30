"""Export daily puzzles for the web app.

A puzzle is a real position from the model's self-play where its best move
is clearly better than the next best: the gap in calibrated win chance is at
least GAP, the game is not already decided, and there are at least four
options. One puzzle per game, so puzzles do not repeat a deal.

Run from the repo root: python3 scripts/export_puzzles.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from big2_ai.env import Big2Game, get_legal_moves  # noqa: E402
from big2_ai.env.game import Move  # noqa: E402
from big2_ai.env.selfplay_encoding import encode_moves, encode_state  # noqa: E402
from big2_ai.models.selfplay_network import SelfPlayNetwork  # noqa: E402
from big2_ai.training.selfplay import choose_move  # noqa: E402

OUT = Path("web/public/puzzles.json")
COUNT = 365
GAP = 0.08
# Same calibration as web/src/lib/model/advice.ts.
CALIBRATION = [(-1.0, 0.013), (-0.7, 0.092), (-0.5, 0.188), (-0.3, 0.304), (-0.1, 0.435),
               (0.1, 0.542), (0.3, 0.614), (0.5, 0.792), (0.8, 0.952)]


def win_chance(score):
    xs, ys = zip(*CALIBRATION)
    return float(min(0.99, max(0.01, np.interp(score, xs, ys))))


def puzzle_from(game, model):
    """The position as a puzzle if it qualifies, else None."""
    player = game.current_player
    if game.first_move:
        return None
    legal = [sorted(m.cards) for m in get_legal_moves(game, player)]
    if len(legal) < 4:
        return None
    moves = [Move(cards, player) for cards in legal]
    with torch.no_grad():
        scores = model(torch.from_numpy(encode_state(game, player)).float().unsqueeze(0),
                       torch.from_numpy(encode_moves(moves)).float()).reshape(-1).tolist()
    order = sorted(range(len(legal)), key=lambda i: -scores[i])
    best, second = win_chance(scores[order[0]]), win_chance(scores[order[1]])
    if best - second < GAP or not 0.15 <= best <= 0.85:
        return None
    return {
        "hands": [sorted(h) for h in game.hands],
        "current": player,
        "firstMove": False,
        "lastPlay": None if game.last_move is None else
        {"player": game.last_move.player, "cards": sorted(game.last_move.cards)},
        "passes": game.passes_since_last_move,
        "history": [{"player": m.player, "cards": sorted(m.cards)} for m in game.move_history],
        "winner": None,
        "best": legal[order[0]],
    }


def main():
    model = SelfPlayNetwork()
    model.load_state_dict(torch.load("models/selfplay_v1.pt", map_location="cpu")["model_state_dict"])
    model.eval()
    puzzles = []
    seed = 50_000
    while len(puzzles) < COUNT:
        game = Big2Game(seed=seed)
        seed += 1
        found = None
        while not game.done:
            if found is None and len(game.hands[game.current_player]) <= 11:
                found = puzzle_from(game, model)
            game.step(choose_move(model, game, game.current_player)[0])
        if found:
            puzzles.append(found)
    OUT.write_text(json.dumps(puzzles, separators=(",", ":")))
    print(f"wrote {len(puzzles)} puzzles from {seed - 50_000} games to {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
