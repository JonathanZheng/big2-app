"""Move type detection for Big 2."""

from enum import Enum
from typing import List, Optional, Tuple
from collections import Counter


class MoveType(Enum):
    """Types of moves in Big 2."""
    PASS = 0
    SINGLE = 1
    PAIR = 2
    TRIPLE = 3
    STRAIGHT = 4  # 5 cards
    FLUSH = 5  # 5 cards
    FULL_HOUSE = 6  # 3 + 2
    QUAD_WITH_KICKER = 7  # 4 + 1
    STRAIGHT_FLUSH = 8  # 5 cards
    INVALID = 9


def card_rank(card: int) -> int:
    """Get rank of a card (0-12)."""
    return card // 4


def card_suit(card: int) -> int:
    """Get suit of a card (0-3)."""
    return card % 4


# Straight rank sets, lowest to highest (house rules):
# 3-4-5-6-7 < ... < 10-J-Q-K-A < J-Q-K-A-2 < 2-3-4-5-6 < A-2-3-4-5
STRAIGHT_RANKS = [tuple(range(low, low + 5)) for low in range(9)] + [
    (0, 1, 2, 3, 12),   # 2-3-4-5-6
    (0, 1, 2, 11, 12),  # A-2-3-4-5
]
_STRAIGHT_KEYS = {frozenset(r): i for i, r in enumerate(STRAIGHT_RANKS)}


def straight_key(ranks: List[int]) -> int:
    """Position of these ranks in STRAIGHT_RANKS, or -1 if not a straight."""
    if len(ranks) != 5:
        return -1
    return _STRAIGHT_KEYS.get(frozenset(ranks), -1)


def is_straight(ranks: List[int]) -> bool:
    """Check if ranks form a straight under the house rules."""
    return straight_key(ranks) >= 0


def is_flush(suits: List[int]) -> bool:
    """Check if all cards are same suit."""
    return len(set(suits)) == 1


def detect_move_type(cards: List[int]) -> MoveType:
    """
    Detect the type of a move.

    Args:
        cards: List of card indices (0-51)

    Returns:
        MoveType enum
    """
    if len(cards) == 0:
        return MoveType.PASS

    if len(cards) == 1:
        return MoveType.SINGLE

    ranks = [card_rank(c) for c in cards]
    suits = [card_suit(c) for c in cards]
    rank_counts = Counter(ranks)

    if len(cards) == 2:
        # Must be a pair
        if len(rank_counts) == 1:
            return MoveType.PAIR
        return MoveType.INVALID

    if len(cards) == 3:
        # Must be a triple
        if len(rank_counts) == 1:
            return MoveType.TRIPLE
        return MoveType.INVALID

    if len(cards) == 5:
        # Could be straight, flush, or straight flush
        is_str = is_straight(ranks)
        is_fl = is_flush(suits)

        if is_str and is_fl:
            return MoveType.STRAIGHT_FLUSH
        elif is_str:
            return MoveType.STRAIGHT
        elif is_fl:
            return MoveType.FLUSH
        else:
            # Check for full house (3+2) or quad with kicker (4+1)
            if len(rank_counts) == 2:
                counts = sorted(rank_counts.values())
                if counts == [2, 3]:
                    return MoveType.FULL_HOUSE
                if counts == [1, 4]:
                    return MoveType.QUAD_WITH_KICKER
            return MoveType.INVALID

    return MoveType.INVALID


def get_move_value(cards: List[int], move_type: MoveType) -> Tuple[int, int]:
    """
    Get the value of a move for comparison.

    Returns:
        (primary_rank, highest_suit) - higher values beat lower values
    """
    if move_type == MoveType.PASS:
        return (-1, -1)

    ranks = [card_rank(c) for c in cards]
    suits = [card_suit(c) for c in cards]

    if move_type == MoveType.SINGLE:
        return (ranks[0], suits[0])

    if move_type in [MoveType.PAIR, MoveType.TRIPLE]:
        # Use the rank and highest suit
        return (ranks[0], max(suits))

    if move_type in [MoveType.STRAIGHT, MoveType.STRAIGHT_FLUSH]:
        # Straight order, then suit of the highest card (the 2 when present)
        max_card = max(cards)
        return (straight_key(ranks), card_suit(max_card))

    if move_type == MoveType.FLUSH:
        # Compare by highest card
        max_card = max(cards)
        return (card_rank(max_card), card_suit(max_card))

    if move_type == MoveType.FULL_HOUSE:
        # Compare by the triple
        rank_counts = Counter(ranks)
        triple_rank = [r for r, c in rank_counts.items() if c == 3][0]
        triple_cards = [c for c in cards if card_rank(c) == triple_rank]
        max_suit = max(card_suit(c) for c in triple_cards)
        return (triple_rank, max_suit)

    if move_type == MoveType.QUAD_WITH_KICKER:
        # Compare by the quad
        rank_counts = Counter(ranks)
        quad_rank = [r for r, c in rank_counts.items() if c == 4][0]
        quad_cards = [c for c in cards if card_rank(c) == quad_rank]
        max_suit = max(card_suit(c) for c in quad_cards)
        return (quad_rank, max_suit)

    return (-1, -1)


def can_beat(move_cards: List[int], last_move_cards: List[int]) -> bool:
    """
    Check if move_cards can beat last_move_cards.

    Args:
        move_cards: Cards to play
        last_move_cards: Cards from last move

    Returns:
        True if move_cards beats last_move_cards
    """
    if len(last_move_cards) == 0:
        # No last move, any move is valid
        return True

    move_type = detect_move_type(move_cards)
    last_type = detect_move_type(last_move_cards)

    if move_type == MoveType.INVALID:
        return False

    # Must play same type (except for special combos)
    if len(move_cards) != len(last_move_cards):
        return False

    # For 5-card hands, special rules apply
    if len(move_cards) == 5:
        # Rank of combo types (higher beats lower)
        type_ranks = {
            MoveType.STRAIGHT: 1,
            MoveType.FLUSH: 2,
            MoveType.FULL_HOUSE: 3,
            MoveType.QUAD_WITH_KICKER: 4,
            MoveType.STRAIGHT_FLUSH: 5,
        }

        move_rank = type_ranks.get(move_type, 0)
        last_rank = type_ranks.get(last_type, 0)

        if move_rank > last_rank:
            return True
        elif move_rank < last_rank:
            return False
        # Same type, compare values
    else:
        # Must be same type
        if move_type != last_type:
            return False

    # Compare values
    move_val = get_move_value(move_cards, move_type)
    last_val = get_move_value(last_move_cards, last_type)

    # Higher rank wins, or same rank but higher suit
    if move_val[0] > last_val[0]:
        return True
    elif move_val[0] == last_val[0] and move_val[1] > last_val[1]:
        return True

    return False


def test_move_detector():
    """Test move detection."""
    print("Testing move detector...")

    # Test single
    assert detect_move_type([0]) == MoveType.SINGLE
    print("✓ Single")

    # Test pair
    assert detect_move_type([0, 1]) == MoveType.PAIR  # 3♦ 3♣
    print("✓ Pair")

    # Test triple
    assert detect_move_type([0, 1, 2]) == MoveType.TRIPLE  # 3♦ 3♣ 3♥
    print("✓ Triple")

    # Test straight: 3,4,5,6,7
    straight = [0, 4, 8, 12, 16]  # 3♦ 4♦ 5♦ 6♦ 7♦
    assert detect_move_type(straight) == MoveType.STRAIGHT_FLUSH
    print("✓ Straight flush")

    # Test flush: all diamonds
    flush = [0, 4, 8, 12, 20]  # 3♦ 4♦ 5♦ 6♦ 8♦ (not consecutive)
    assert detect_move_type(flush) == MoveType.FLUSH
    print("✓ Flush")

    # Test full house: 3,3,3,4,4
    full_house = [0, 1, 2, 4, 5]  # 3♦ 3♣ 3♥ 4♦ 4♣
    assert detect_move_type(full_house) == MoveType.FULL_HOUSE
    print("✓ Full house")

    # Test comparison
    assert can_beat([1], [0])  # 3♣ beats 3♦
    print("✓ Comparison")

    print("All tests passed!")


if __name__ == "__main__":
    test_move_detector()
