"""Export positions from Python games as JSON fixtures for the web app's tests.

Each position records the full game state, the legal moves in canonical
order, the model's input encoding and scores, and the greedy and Smart bots'
choices. The web tests check the TypeScript engine, encoding, network and
bots against these.

Run from the repo root: python3 scripts/export_web_fixtures.py
"""

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from big2_ai.agents import select_action_greedy_bot, select_action_smart_bot
from big2_ai.env import Big2Game, get_legal_moves
from big2_ai.env.game import Move
from big2_ai.env.selfplay_encoding import encode_moves, encode_state
from big2_ai.models.selfplay_network import SelfPlayNetwork
from big2_ai.training.selfplay import choose_move

OUT = Path("web/src/lib/engine/__fixtures__/positions.json")
MODEL = "models/selfplay_v1.pt"


def canonical(moves):
    """Pass first, then by number of cards, then by sorted card numbers."""
    return sorted((sorted(m) for m in moves), key=lambda m: (len(m), m))


def snapshot(game, model):
    player = game.current_player
    legal = canonical(m.cards for m in get_legal_moves(game, player))
    moves = [Move(cards, player) for cards in legal]
    with torch.no_grad():
        scores = model(torch.from_numpy(encode_state(game, player)).float().unsqueeze(0),
                       torch.from_numpy(encode_moves(moves)).float())
    return {
        "hands": [sorted(h) for h in game.hands],
        "current": player,
        "firstMove": game.first_move,
        "lastPlay": None if game.last_move is None else
        {"player": game.last_move.player, "cards": sorted(game.last_move.cards)},
        "passes": game.passes_since_last_move,
        "history": [{"player": m.player, "cards": sorted(m.cards)} for m in game.move_history],
        "legal": legal,
        "stateOnes": [int(i) for i in encode_state(game, player).nonzero()[0]],
        "scores": [round(float(s), 6) for s in scores.reshape(-1)],
        "greedy": sorted(select_action_greedy_bot(game, player).cards),
        "smart": sorted(select_action_smart_bot(game, player).cards),
    }


def main():
    model = SelfPlayNetwork()
    model.load_state_dict(torch.load(MODEL, map_location="cpu")["model_state_dict"])
    model.eval()

    positions = [snapshot(Big2Game(seed=1000), model)]  # an opening position
    for seed in range(60):
        game = Big2Game(seed=seed)
        decision, taken = 0, 0
        while not game.done and taken < 5:
            if decision % 3 == 0:
                positions.append(snapshot(game, model))
                taken += 1
            game.step(choose_move(model, game, game.current_player)[0])
            decision += 1

    OUT.write_text(json.dumps(positions, separators=(",", ":")))
    print(f"wrote {len(positions)} positions to {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
