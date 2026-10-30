"""Legal move generation for Big 2 - Optimized with rank/suit maps."""

from typing import List, Dict, Tuple
from collections import defaultdict

from .game import Move, card_rank, card_suit
from .move_detector import detect_move_type, can_beat, is_straight, MoveType, STRAIGHT_RANKS


def build_maps(hand: List[int]) -> Tuple[Dict[int, List[int]], Dict[int, List[int]]]:
    """
    Build rank and suit maps from a hand.

    Args:
        hand: List of card indices (0-51)

    Returns:
        (rank_map, suit_map) where:
        - rank_map: {rank: [cards]} - cards grouped by rank (0-12)
        - suit_map: {suit: [cards]} - cards grouped by suit (0-3)
    """
    rank_map = defaultdict(list)
    suit_map = defaultdict(list)

    for card in hand:
        rank_map[card_rank(card)].append(card)
        suit_map[card_suit(card)].append(card)

    return rank_map, suit_map


def get_legal_moves(game, player: int) -> List[Move]:
    """
    Generate all legal moves for a player.

    Args:
        game: Big2Game instance
        player: Player index (0-3)

    Returns:
        List of legal Move objects
    """
    hand = game.hands[player]

    # Build maps once for this hand
    rank_map, suit_map = build_maps(hand)

    moves = []

    # First move must contain 3♦ (card 0)
    if game.first_move:
        moves.extend(generate_first_moves(hand, player, rank_map, suit_map))
        return moves

    # If there's a last move, can pass
    if game.last_move is not None:
        moves.append(Move([], player))

    # If no last move or starting new trick, can play anything
    if game.last_move is None:
        moves.extend(generate_all_moves(hand, player, rank_map, suit_map))
    else:
        # Must beat last move - only generate moves of matching length
        last_cards = game.last_move.cards
        moves.extend(generate_beating_moves(hand, last_cards, player, rank_map, suit_map))

    return moves


def generate_singles(hand: List[int], player: int) -> List[Move]:
    """Generate all single card moves."""
    return [Move([card], player) for card in hand]


def generate_pairs(rank_map: Dict[int, List[int]], player: int) -> List[Move]:
    """Generate all pair moves using rank map."""
    moves = []
    for cards in rank_map.values():
        if len(cards) >= 2:
            # Generate all pairs from cards of same rank
            for i in range(len(cards)):
                for j in range(i + 1, len(cards)):
                    moves.append(Move([cards[i], cards[j]], player))
    return moves


def generate_triples(rank_map: Dict[int, List[int]], player: int) -> List[Move]:
    """Generate all triple moves using rank map."""
    moves = []
    for cards in rank_map.values():
        if len(cards) >= 3:
            # Generate all triples from cards of same rank
            for i in range(len(cards)):
                for j in range(i + 1, len(cards)):
                    for k in range(j + 1, len(cards)):
                        moves.append(Move([cards[i], cards[j], cards[k]], player))
    return moves


def generate_straights(hand: List[int], rank_map: Dict[int, List[int]], player: int) -> List[Move]:
    """
    Generate all straight moves (rank sets in STRAIGHT_RANKS).

    Optimized: Only check straight rank sets instead of all C(n,5) combinations.
    """
    moves = []

    for straight_ranks in STRAIGHT_RANKS:
        # Check if we have cards at all 5 ranks
        if all(r in rank_map for r in straight_ranks):
            # Generate all combinations of cards from these ranks
            _generate_straight_combos(rank_map, list(straight_ranks), player, moves)

    return moves


def _generate_straight_combos(rank_map: Dict[int, List[int]], ranks: List[int],
                               player: int, moves: List[Move]):
    """Generate all straight combinations from given consecutive ranks."""
    # Get cards for each rank
    cards_per_rank = [rank_map[r] for r in ranks]

    # Generate cartesian product (one card from each rank)
    def generate(idx: int, current: List[int]):
        if idx == 5:
            # Check if it's a valid straight (not a straight flush)
            suits = [card_suit(c) for c in current]
            if len(set(suits)) > 1:  # Not all same suit = regular straight
                moves.append(Move(current.copy(), player))
            return

        for card in cards_per_rank[idx]:
            current.append(card)
            generate(idx + 1, current)
            current.pop()

    generate(0, [])


def generate_flushes(suit_map: Dict[int, List[int]], player: int) -> List[Move]:
    """
    Generate all flush moves (5 cards of same suit, not a straight).

    Optimized: Only check within same-suit groups.
    """
    moves = []

    for suit, cards in suit_map.items():
        if len(cards) >= 5:
            # Generate all 5-card combinations from this suit
            _generate_flush_combos(cards, player, moves)

    return moves


def _generate_flush_combos(cards: List[int], player: int, moves: List[Move]):
    """Generate all 5-card flush combinations from same-suit cards."""
    n = len(cards)

    # Generate C(n, 5) combinations
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                for l in range(k + 1, n):
                    for m in range(l + 1, n):
                        combo = [cards[i], cards[j], cards[k], cards[l], cards[m]]
                        # Check it's not a straight
                        if not is_straight([card_rank(c) for c in combo]):
                            moves.append(Move(combo, player))


def generate_straight_flushes(suit_map: Dict[int, List[int]], player: int) -> List[Move]:
    """
    Generate all straight flush moves.

    Optimized: Check consecutive ranks within each suit.
    """
    moves = []

    for suit, cards in suit_map.items():
        if len(cards) >= 5:
            # Build rank map for this suit only
            suit_rank_map = defaultdict(list)
            for card in cards:
                suit_rank_map[card_rank(card)].append(card)

            # Find straight rank sets within this suit
            for straight_ranks in STRAIGHT_RANKS:
                if all(r in suit_rank_map for r in straight_ranks):
                    # All ranks present in this suit - it's a straight flush
                    combo = [suit_rank_map[r][0] for r in straight_ranks]
                    moves.append(Move(combo, player))

    return moves


def generate_full_houses(rank_map: Dict[int, List[int]], player: int) -> List[Move]:
    """
    Generate all full house moves (3 of a kind + pair).

    Optimized: Use rank map to find 3s and 2s directly.
    """
    moves = []

    # Find ranks with 3+ cards (for triple part)
    triple_ranks = [r for r, cards in rank_map.items() if len(cards) >= 3]
    # Find ranks with 2+ cards (for pair part)
    pair_ranks = [r for r, cards in rank_map.items() if len(cards) >= 2]

    for triple_rank in triple_ranks:
        triple_cards = rank_map[triple_rank]
        # Generate all triples from this rank
        for i in range(len(triple_cards)):
            for j in range(i + 1, len(triple_cards)):
                for k in range(j + 1, len(triple_cards)):
                    triple = [triple_cards[i], triple_cards[j], triple_cards[k]]

                    # Add all pairs from different ranks
                    for pair_rank in pair_ranks:
                        if pair_rank != triple_rank:
                            pair_cards = rank_map[pair_rank]
                            for p in range(len(pair_cards)):
                                for q in range(p + 1, len(pair_cards)):
                                    pair = [pair_cards[p], pair_cards[q]]
                                    moves.append(Move(triple + pair, player))

    return moves


def generate_quads_with_kicker(rank_map: Dict[int, List[int]], hand: List[int], player: int) -> List[Move]:
    """
    Generate all quad with kicker moves (4 of a kind + any card).

    Optimized: Use rank map to find quads directly.
    """
    moves = []

    # Find ranks with exactly 4 cards
    quad_ranks = [r for r, cards in rank_map.items() if len(cards) == 4]

    for quad_rank in quad_ranks:
        quad = rank_map[quad_rank]
        # Add any other card as kicker
        for card in hand:
            if card_rank(card) != quad_rank:
                moves.append(Move(quad + [card], player))

    return moves


def generate_all_moves(hand: List[int], player: int,
                       rank_map: Dict[int, List[int]],
                       suit_map: Dict[int, List[int]]) -> List[Move]:
    """
    Generate all possible moves (when starting a new trick).
    """
    moves = []

    # Singles
    moves.extend(generate_singles(hand, player))

    # Pairs
    moves.extend(generate_pairs(rank_map, player))

    # Triples
    moves.extend(generate_triples(rank_map, player))

    # 5-card combinations (only if hand has 5+ cards)
    if len(hand) >= 5:
        moves.extend(generate_straights(hand, rank_map, player))
        moves.extend(generate_flushes(suit_map, player))
        moves.extend(generate_straight_flushes(suit_map, player))
        moves.extend(generate_full_houses(rank_map, player))
        moves.extend(generate_quads_with_kicker(rank_map, hand, player))

    return moves


def generate_first_moves(hand: List[int], player: int,
                         rank_map: Dict[int, List[int]],
                         suit_map: Dict[int, List[int]]) -> List[Move]:
    """
    Generate all legal first moves (must contain 3♦ = card 0).
    """
    moves = []

    if 0 not in hand:
        return moves

    # Single 3♦
    moves.append(Move([0], player))

    # Pairs with 3 (rank 0)
    if len(rank_map[0]) >= 2:
        cards_of_3 = rank_map[0]
        for i in range(len(cards_of_3)):
            for j in range(i + 1, len(cards_of_3)):
                if cards_of_3[i] == 0 or cards_of_3[j] == 0:  # Must include 3♦
                    moves.append(Move([cards_of_3[i], cards_of_3[j]], player))

    # Triples with 3
    if len(rank_map[0]) >= 3:
        cards_of_3 = rank_map[0]
        for i in range(len(cards_of_3)):
            for j in range(i + 1, len(cards_of_3)):
                for k in range(j + 1, len(cards_of_3)):
                    if 0 in [cards_of_3[i], cards_of_3[j], cards_of_3[k]]:
                        moves.append(Move([cards_of_3[i], cards_of_3[j], cards_of_3[k]], player))

    # 5-card combos containing 3♦
    if len(hand) >= 5:
        # Straights containing 3♦ (rank 0)
        for combo in _first_move_straights(rank_map, player):
            moves.append(combo)

        # Flushes containing 3♦ (must be diamond suit = 0)
        if 0 in suit_map and len(suit_map[0]) >= 5:
            for combo in _first_move_flushes(suit_map[0], player):
                moves.append(combo)

        # Straight flushes containing 3♦
        if 0 in suit_map and len(suit_map[0]) >= 5:
            for combo in _first_move_straight_flushes(suit_map[0], player):
                moves.append(combo)

        # Full houses containing 3♦
        for combo in _first_move_full_houses(rank_map, player):
            moves.append(combo)

        # Quads with 3♦ (either as part of quad or as kicker)
        for combo in _first_move_quads(rank_map, hand, player):
            moves.append(combo)

    return moves


def _first_move_straights(rank_map: Dict[int, List[int]], player: int) -> List[Move]:
    """Generate straights containing 3♦ (card 0)."""
    moves = []
    # Only straights containing rank 0 (3): 3-4-5-6-7, 2-3-4-5-6, A-2-3-4-5
    for ranks in STRAIGHT_RANKS:
        if 0 not in ranks or not all(r in rank_map for r in ranks):
            continue
        cards_per_rank = [rank_map[r] for r in ranks]

        def generate(idx: int, current: List[int], has_3d: bool):
            if idx == 5:
                if has_3d:
                    suits = [card_suit(c) for c in current]
                    if len(set(suits)) > 1:  # Not straight flush
                        moves.append(Move(current.copy(), player))
                return

            for card in cards_per_rank[idx]:
                generate(idx + 1, current + [card], has_3d or card == 0)

        generate(0, [], False)
    return moves


def _first_move_flushes(diamond_cards: List[int], player: int) -> List[Move]:
    """Generate flushes containing 3♦ from diamond cards."""
    moves = []
    n = len(diamond_cards)

    # 3♦ = card 0 must be included
    if 0 not in diamond_cards:
        return moves

    # Generate C(n-1, 4) combinations from other diamonds, always include 0
    other_cards = [c for c in diamond_cards if c != 0]

    for i in range(len(other_cards)):
        for j in range(i + 1, len(other_cards)):
            for k in range(j + 1, len(other_cards)):
                for l in range(k + 1, len(other_cards)):
                    combo = [0, other_cards[i], other_cards[j], other_cards[k], other_cards[l]]
                    # Check it's not a straight
                    if not is_straight([card_rank(c) for c in combo]):
                        moves.append(Move(combo, player))

    return moves


def _first_move_straight_flushes(diamond_cards: List[int], player: int) -> List[Move]:
    """Generate straight flushes containing 3♦."""
    moves = []

    # Build rank map for diamonds
    rank_map = defaultdict(list)
    for card in diamond_cards:
        rank_map[card_rank(card)].append(card)

    # Only diamond straights containing the 3: 3-4-5-6-7, 2-3-4-5-6, A-2-3-4-5
    for ranks in STRAIGHT_RANKS:
        if 0 in ranks and all(r in rank_map for r in ranks):
            combo = [rank_map[r][0] for r in ranks]
            moves.append(Move(combo, player))

    return moves


def _first_move_full_houses(rank_map: Dict[int, List[int]], player: int) -> List[Move]:
    """Generate full houses containing 3♦."""
    moves = []

    # Case 1: 3♦ is part of triple (need three 3s)
    if len(rank_map[0]) >= 3:
        cards_of_3 = rank_map[0]
        # Generate triples containing 3♦
        for i in range(len(cards_of_3)):
            for j in range(i + 1, len(cards_of_3)):
                for k in range(j + 1, len(cards_of_3)):
                    if 0 in [cards_of_3[i], cards_of_3[j], cards_of_3[k]]:
                        triple = [cards_of_3[i], cards_of_3[j], cards_of_3[k]]
                        # Add pairs from other ranks
                        for pair_rank, pair_cards in rank_map.items():
                            if pair_rank != 0 and len(pair_cards) >= 2:
                                for p in range(len(pair_cards)):
                                    for q in range(p + 1, len(pair_cards)):
                                        moves.append(Move(triple + [pair_cards[p], pair_cards[q]], player))

    # Case 2: 3♦ is part of pair (need two 3s including 3♦)
    if len(rank_map[0]) >= 2:
        cards_of_3 = rank_map[0]
        # Generate pairs containing 3♦
        for i in range(len(cards_of_3)):
            if cards_of_3[i] == 0 or (i > 0 and 0 in cards_of_3[:i]):
                continue  # Skip if 3♦ not in pair
            for j in range(i + 1, len(cards_of_3)):
                if 0 not in [cards_of_3[i], cards_of_3[j]]:
                    continue
                pair = [cards_of_3[i], cards_of_3[j]]
                # Add triples from other ranks
                for triple_rank, triple_cards in rank_map.items():
                    if triple_rank != 0 and len(triple_cards) >= 3:
                        for a in range(len(triple_cards)):
                            for b in range(a + 1, len(triple_cards)):
                                for c in range(b + 1, len(triple_cards)):
                                    moves.append(Move([triple_cards[a], triple_cards[b], triple_cards[c]] + pair, player))

    return moves


def _first_move_quads(rank_map: Dict[int, List[int]], hand: List[int], player: int) -> List[Move]:
    """Generate quads with kicker containing 3♦."""
    moves = []

    # Case 1: Quad of 3s with any kicker
    if len(rank_map[0]) == 4:
        quad = rank_map[0]
        for card in hand:
            if card_rank(card) != 0:
                moves.append(Move(quad + [card], player))

    # Case 2: Any quad with 3♦ as kicker
    for quad_rank, cards in rank_map.items():
        if len(cards) == 4 and quad_rank != 0:
            moves.append(Move(cards + [0], player))

    return moves


def generate_beating_moves(hand: List[int], last_cards: List[int], player: int,
                           rank_map: Dict[int, List[int]],
                           suit_map: Dict[int, List[int]]) -> List[Move]:
    """
    Generate all moves that beat the last move.

    Optimized: Only generate moves of matching length.
    """
    moves = []
    last_len = len(last_cards)

    if last_len == 1:
        # Must play a higher single
        for card in hand:
            if can_beat([card], last_cards):
                moves.append(Move([card], player))

    elif last_len == 2:
        # Must play a higher pair - use rank map
        for cards in rank_map.values():
            if len(cards) >= 2:
                for i in range(len(cards)):
                    for j in range(i + 1, len(cards)):
                        combo = [cards[i], cards[j]]
                        if can_beat(combo, last_cards):
                            moves.append(Move(combo, player))

    elif last_len == 3:
        # Must play a higher triple - use rank map
        for cards in rank_map.values():
            if len(cards) >= 3:
                for i in range(len(cards)):
                    for j in range(i + 1, len(cards)):
                        for k in range(j + 1, len(cards)):
                            combo = [cards[i], cards[j], cards[k]]
                            if can_beat(combo, last_cards):
                                moves.append(Move(combo, player))

    elif last_len == 5:
        # Must play a higher 5-card combo
        if len(hand) >= 5:
            last_type = detect_move_type(last_cards)

            # Generate candidates based on what can beat the last type
            # Type hierarchy: Straight < Flush < Full House < Quad+Kicker < Straight Flush

            if last_type == MoveType.STRAIGHT:
                # Can beat with higher straight, or any flush/full house/quad/SF
                for combo in generate_straights(hand, rank_map, player):
                    if can_beat(combo.cards, last_cards):
                        moves.append(combo)
                moves.extend(generate_flushes(suit_map, player))
                moves.extend(generate_full_houses(rank_map, player))
                moves.extend(generate_quads_with_kicker(rank_map, hand, player))
                moves.extend(generate_straight_flushes(suit_map, player))

            elif last_type == MoveType.FLUSH:
                # Can beat with higher flush, or full house/quad/SF
                for combo in generate_flushes(suit_map, player):
                    if can_beat(combo.cards, last_cards):
                        moves.append(combo)
                moves.extend(generate_full_houses(rank_map, player))
                moves.extend(generate_quads_with_kicker(rank_map, hand, player))
                moves.extend(generate_straight_flushes(suit_map, player))

            elif last_type == MoveType.FULL_HOUSE:
                # Can beat with higher full house, or quad/SF
                for combo in generate_full_houses(rank_map, player):
                    if can_beat(combo.cards, last_cards):
                        moves.append(combo)
                moves.extend(generate_quads_with_kicker(rank_map, hand, player))
                moves.extend(generate_straight_flushes(suit_map, player))

            elif last_type == MoveType.QUAD_WITH_KICKER:
                # Can beat with higher quad, or SF
                for combo in generate_quads_with_kicker(rank_map, hand, player):
                    if can_beat(combo.cards, last_cards):
                        moves.append(combo)
                moves.extend(generate_straight_flushes(suit_map, player))

            elif last_type == MoveType.STRAIGHT_FLUSH:
                # Can only beat with higher straight flush
                for combo in generate_straight_flushes(suit_map, player):
                    if can_beat(combo.cards, last_cards):
                        moves.append(combo)

    return moves


def test_move_generator():
    """Test move generation."""
    from .game import Big2Game

    print("Testing optimized move generator...")

    game = Big2Game(seed=42)
    print(f"Initial game state:")
    print(game)
    print()

    # Get first moves
    moves = get_legal_moves(game, game.current_player)
    print(f"Player {game.current_player} has {len(moves)} legal first moves")
    print(f"First 5 moves: {moves[:5]}")
    print()

    # Play first move
    game.step(moves[0])
    print(f"After first move: {game}")
    print()

    # Get next moves
    moves = get_legal_moves(game, game.current_player)
    print(f"Player {game.current_player} has {len(moves)} legal moves")
    print(f"First 5 moves: {moves[:5]}")

    print("\nTest complete!")


if __name__ == "__main__":
    test_move_generator()
