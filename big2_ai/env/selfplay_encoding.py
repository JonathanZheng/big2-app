"""State and move encoding for the self-play model.

Every feature is 0 or 1, so encodings are stored as uint8.

State (566), from the acting player's point of view:
- hand (52)
- unseen cards: not in my hand and not played yet (52)
- cards played by each opponent: next, across, previous (3 x 52)
- current trick to beat, zeros when leading (52)
- who played the current trick: me, next, across, previous (4)
- passes since the trick was played: 0, 1, 2 (3)
- each opponent's card count, one-hot 1 to 13 (3 x 13)
- last 4 moves, oldest first, passes are zeros (4 x 52)

Move (61): cards (52) + move type one-hot (9: pass, single, pair, triple,
straight, flush, full house, four of a kind, straight flush).
"""

from typing import List

import numpy as np

from .game import Big2Game, Move
from .move_detector import detect_move_type

STATE_DIM = 566
MOVE_DIM = 61
RECENT_MOVES = 4

_HAND = 0
_UNSEEN = 52
_PLAYED = 104
_TRICK = 260
_TRICK_OWNER = 312
_PASSES = 316
_COUNTS = 319
_RECENT = 358


def encode_state(game: Big2Game, player: int) -> np.ndarray:
    """Encode the game from `player`'s point of view."""
    state = np.zeros(STATE_DIM, dtype=np.uint8)

    hand = game.hands[player]
    state[_HAND + np.array(hand, dtype=np.int64)] = 1

    seen = np.zeros(52, dtype=np.uint8)
    seen[hand] = 1
    for move in game.move_history:
        if move.cards:
            seen[move.cards] = 1
            rel = (move.player - player) % 4
            if rel:
                state[_PLAYED + (rel - 1) * 52 + np.array(move.cards)] = 1
    state[_UNSEEN:_UNSEEN + 52] = 1 - seen

    if game.last_move is not None:
        state[_TRICK + np.array(game.last_move.cards)] = 1
        state[_TRICK_OWNER + (game.last_move.player - player) % 4] = 1
        state[_PASSES + game.passes_since_last_move] = 1

    for rel in range(1, 4):
        count = len(game.hands[(player + rel) % 4])
        if count:
            state[_COUNTS + (rel - 1) * 13 + count - 1] = 1

    recent = game.move_history[-RECENT_MOVES:]
    offset = RECENT_MOVES - len(recent)
    for i, move in enumerate(recent):
        if move.cards:
            state[_RECENT + (offset + i) * 52 + np.array(move.cards)] = 1

    return state


def encode_moves(moves: List[Move]) -> np.ndarray:
    """Encode a list of moves as a (len(moves), 61) array."""
    encoded = np.zeros((len(moves), MOVE_DIM), dtype=np.uint8)
    for i, move in enumerate(moves):
        if move.cards:
            encoded[i, move.cards] = 1
        encoded[i, 52 + detect_move_type(move.cards).value] = 1
    return encoded


def test_encoding():
    """Test self-play encoding."""
    from .move_generator import get_legal_moves

    print("Testing self-play encoding...")
    game = Big2Game(seed=1)
    for _ in range(12):
        moves = get_legal_moves(game, game.current_player)
        game.step(moves[-1])

    for player in range(4):
        state = encode_state(game, player)
        assert state.shape == (STATE_DIM,)
        assert state[_HAND:_HAND + 52].sum() == len(game.hands[player])
        played = sum(len(m.cards) for m in game.move_history)
        assert state[_UNSEEN:_UNSEEN + 52].sum() == 52 - played - len(game.hands[player])
        assert state[_COUNTS:_COUNTS + 39].sum() == 3
    moves = get_legal_moves(game, game.current_player)
    encoded = encode_moves(moves)
    assert encoded.shape == (len(moves), MOVE_DIM)
    assert (encoded[:, 52:].sum(axis=1) == 1).all()
    print(f"  State {STATE_DIM}, move {MOVE_DIM}, {len(moves)} legal moves encoded")
    print("\nTest complete!")


if __name__ == "__main__":
    test_encoding()
