"""Smart heuristic bot for Big 2 (Patwa 2026, arXiv:2605.28863, Algorithm 2).

Scores every legal non-pass move and plays the lowest score. Passes only when
the best early-game reply spends two or more 2s, or the trick is a four of a
kind or straight flush.

Details the paper leaves open (our calls):
- rank(c) is the 0-12 rank index (3 = 0, 2 = 12).
- A "low orphan" is a remaining card whose rank appears once and is 3 through 9.
- A "very strong" trick contains a 2.
- BreakPenalty is the larger of the pair/triple and five-card penalties.
"""

from collections import Counter
from typing import List

from ..env import Big2Game, get_legal_moves
from ..env.game import card_rank, card_suit
from ..env.move_detector import detect_move_type, MoveType

TWO = 12
LOW_ORPHAN_MAX_RANK = 6  # rank 9


def select_action_smart_bot(game: Big2Game, player: int):
    """Select a move using the Smart heuristic."""
    legal_moves = get_legal_moves(game, player)

    if len(legal_moves) == 0:
        raise ValueError(f"No legal moves for player {player}")

    candidates = [m for m in legal_moves if not m.is_pass()]
    if not candidates or len(legal_moves) == 1:
        return legal_moves[0]

    hand = game.hands[player]
    phase = _phase(hand)
    trick = game.last_move.cards if game.last_move is not None else []
    trick_is_bomb = bool(trick) and detect_move_type(trick) in (
        MoveType.QUAD_WITH_KICKER, MoveType.STRAIGHT_FLUSH
    )
    trick_very_strong = any(card_rank(c) == TWO for c in trick)

    best_move, best_score = None, None
    for move in candidates:
        score = _score(move.cards, hand, phase, trick_is_bomb, trick_very_strong)
        if best_score is None or score < best_score:
            best_move, best_score = move, score

    can_pass = len(candidates) < len(legal_moves)
    twos_used = sum(1 for c in best_move.cards if card_rank(c) == TWO)
    if can_pass and phase == "early" and twos_used >= 2 and best_score > 30:
        return legal_moves[0]
    if can_pass and trick_is_bomb:
        return legal_moves[0]
    return best_move


def _phase(hand: List[int]) -> str:
    if len(hand) > 10:
        return "early"
    if len(hand) >= 6:
        return "mid"
    return "late"


def _score(cards: List[int], hand: List[int], phase: str,
           trick_is_bomb: bool, trick_very_strong: bool) -> float:
    if len(cards) == len(hand):
        return -1000.0

    twos = sum(1 for c in cards if card_rank(c) == TWO)
    score = 0.8 * sum(card_rank(c) for c in cards)
    if phase == "early":
        score += 10 * twos
    elif phase == "mid":
        score += 5 * twos

    remaining = [c for c in hand if c not in cards]
    score += _break_penalty(cards, hand, remaining, phase)
    score += 6 * _low_orphans(remaining)
    score -= 4 * len(cards)

    if phase == "late":
        score -= 10
        if trick_very_strong:
            score -= 10
    if trick_is_bomb:
        score += 25
    return score


def _break_penalty(cards: List[int], hand: List[int], remaining: List[int], phase: str) -> int:
    penalty = 0

    hand_ranks = Counter(card_rank(c) for c in hand)
    played_ranks = Counter(card_rank(c) for c in cards)
    breaks_group = any(
        hand_ranks[r] in (2, 3) and 0 < n < hand_ranks[r]
        for r, n in played_ranks.items()
    )
    if breaks_group:
        penalty = {"early": 8, "mid": 4, "late": 0}[phase]

    if len(cards) != 5:
        before = _five_card_structures(hand)
        after = _five_card_structures(remaining)
        if before - after:
            penalty = max(penalty, {"early": 20, "mid": 8, "late": 4}[phase])

    return penalty


def _five_card_structures(cards: List[int]) -> set:
    """Potential five-card hands still available in these cards."""
    ranks = Counter(card_rank(c) for c in cards)
    suits = Counter(card_suit(c) for c in cards)
    structures = set()

    for r, n in ranks.items():
        if n == 4:
            structures.add(("quad", r))
    triples = [r for r, n in ranks.items() if n >= 3]
    for t in triples:
        if any(r != t and n >= 2 for r, n in ranks.items()):
            structures.add(("full_house", t))
    for s, n in suits.items():
        if n >= 5:
            structures.add(("flush", s))
    for low in range(0, 8):  # windows 3-7 through 10-A, rank 2 excluded
        if all(ranks[r] > 0 for r in range(low, low + 5)):
            structures.add(("straight", low))

    return structures


def _low_orphans(cards: List[int]) -> int:
    ranks = Counter(card_rank(c) for c in cards)
    return sum(1 for r, n in ranks.items() if n == 1 and r <= LOW_ORPHAN_MAX_RANK)


def test_smart_bot():
    """Test Smart bot decisions."""
    from ..env.game import Move

    print("Testing Smart bot...")

    # Takes an immediate win
    game = Big2Game(seed=0)
    game.first_move = False
    game.hands[0] = [48, 49]  # 2♦ 2♣
    game.last_move = None
    game.current_player = 0
    move = select_action_smart_bot(game, 0)
    assert sorted(move.cards) == [48, 49], move
    print("  Plays the winning pair")

    # Passes on a four of a kind even while holding a straight flush that beats it
    game.hands[0] = [4, 8, 12, 20, 24, 28, 32, 36, 40, 44, 51]
    game.last_move = Move([0, 1, 2, 3, 5], 1)  # four 3s + 4♣
    move = select_action_smart_bot(game, 0)
    assert move.is_pass(), move
    print("  Passes on a four of a kind")

    # Many games run without errors
    from .greedy_bot import select_action_greedy_bot
    for seed in range(50):
        g = Big2Game(seed=seed)
        while not g.done:
            p = g.current_player
            mv = select_action_smart_bot(g, p) if p % 2 == 0 else select_action_greedy_bot(g, p)
            g.step(mv)
    print("  50 full games completed")

    print("\nTest complete!")


if __name__ == "__main__":
    test_smart_bot()
