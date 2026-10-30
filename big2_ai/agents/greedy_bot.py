"""Enhanced greedy bot agent for Big 2."""

from typing import List
from collections import Counter, defaultdict
from itertools import combinations

from ..env import Big2Game, get_legal_moves
from ..env.game import card_rank, card_suit
from ..env.move_detector import detect_move_type, MoveType


# =============================================================================
# Main Entry Point
# =============================================================================

def select_action_greedy_bot(game: Big2Game, player: int):
    """
    Enhanced greedy bot with strategic heuristics.

    Strategy:
    - Analyze hand composition (pairs, triples, straights, flushes)
    - Build game state (opponent positions, hand sizes, last move strength)
    - Score all legal moves based on multiple factors:
      * Preserve valuable combinations
      * Play low cards early, save high cards
      * Prefer multi-card plays
      * Aggressive end-game when low cards
      * Position awareness (block opponents close to winning)
    - Intelligent passing based on game state
    """
    legal_moves = get_legal_moves(game, player)

    if len(legal_moves) == 0:
        raise ValueError(f"No legal moves for player {player}")

    # If only one move, must take it
    if len(legal_moves) == 1:
        return legal_moves[0]

    # Build game state
    game_state = build_game_state(game, player)

    # Select best move using heuristics
    return select_best_move(legal_moves, game.hands[player], game_state)


# =============================================================================
# Phase 1: Helper Functions for Enhanced Greedy Bot
# =============================================================================

def find_straights(hand: List[int]) -> List[List[int]]:
    """
    Find all possible 5-card straights in hand.

    Returns:
        List of straights, each as a list of 5 cards
    """
    straights = []

    # Try all 5-card combinations
    for combo in combinations(hand, 5):
        ranks = sorted([card_rank(c) for c in combo])

        # Check if consecutive
        is_straight = True
        for i in range(4):
            if ranks[i + 1] != ranks[i] + 1:
                is_straight = False
                break

        if is_straight:
            straights.append(list(combo))

    return straights


def find_flushes(hand: List[int]) -> List[List[int]]:
    """
    Find all possible 5-card flushes in hand.

    Returns:
        List of flushes, each as a list of 5 cards
    """
    # Group cards by suit
    suit_cards = defaultdict(list)
    for card in hand:
        suit_cards[card_suit(card)].append(card)

    flushes = []

    # Find 5-card flushes in each suit
    for suit, cards in suit_cards.items():
        if len(cards) >= 5:
            # Add all 5-card combinations of this suit
            for combo in combinations(cards, 5):
                flushes.append(list(combo))

    return flushes


def analyze_hand_composition(hand: List[int]) -> dict:
    """
    Analyze hand to identify valuable combinations.

    Returns:
        Dictionary with:
        - pairs: list of ranks that have pairs
        - triples: list of ranks that have triples
        - quads: list of ranks that have quads
        - straights: list of possible straights
        - flushes: list of possible flushes
        - high_cards: list of high cards (rank >= 10: K, A, 2)
        - singles: list of ranks that appear only once
    """
    ranks = [card_rank(c) for c in hand]
    rank_counts = Counter(ranks)

    return {
        'pairs': [r for r, c in rank_counts.items() if c == 2],
        'triples': [r for r, c in rank_counts.items() if c == 3],
        'quads': [r for r, c in rank_counts.items() if c == 4],
        'straights': find_straights(hand),
        'flushes': find_flushes(hand),
        'high_cards': [c for c in hand if card_rank(c) >= 10],  # K=10, A=11, 2=12
        'singles': [r for r, c in rank_counts.items() if c == 1]
    }


def build_game_state(game: Big2Game, player: int) -> dict:
    """
    Build comprehensive game state information for decision making.

    Returns:
        Dictionary with game state metrics
    """
    opponent_sizes = [len(game.hands[i]) for i in range(4) if i != player]

    return {
        'hand_size': len(game.hands[player]),
        'min_opponent_cards': min(opponent_sizes),
        'max_opponent_cards': max(opponent_sizes),
        'passes_since_last': game.passes_since_last_move,
        'is_first_move': game.first_move,
        'last_move': game.last_move,
        'position': player,
        'turns_remaining': sum(opponent_sizes)
    }


def evaluate_last_move_strength(game_state: dict) -> float:
    """
    Evaluate the strength of the last move (0.0 to 1.0).

    Returns:
        Strength score where 0.0 is weak and 1.0 is very strong
    """
    last_move = game_state['last_move']

    if not last_move or last_move.is_pass():
        return 0.0

    # Get move type
    move_type = detect_move_type(last_move.cards)

    # Base strength by move type
    type_strength = {
        MoveType.SINGLE: 0.2,
        MoveType.PAIR: 0.3,
        MoveType.TRIPLE: 0.4,
        MoveType.STRAIGHT: 0.5,
        MoveType.FLUSH: 0.6,
        MoveType.FULL_HOUSE: 0.7,
        MoveType.QUAD_WITH_KICKER: 0.8,
        MoveType.STRAIGHT_FLUSH: 0.9
    }.get(move_type, 0.0)

    # Adjust based on card ranks
    ranks = [card_rank(c) for c in last_move.cards]
    avg_rank = sum(ranks) / len(ranks)
    rank_strength = avg_rank / 12.0  # Normalize to 0-1

    # Combine (70% type, 30% rank)
    return 0.7 * type_strength + 0.3 * rank_strength


def breaks_combination(move, hand_analysis: dict) -> bool:
    """
    Check if a move breaks a valuable combination.

    Args:
        move: The move to check
        hand_analysis: Hand composition from analyze_hand_composition()

    Returns:
        True if move breaks a valuable combo
    """
    if move.is_pass():
        return False

    move_cards = set(move.cards)
    move_type = detect_move_type(move.cards)
    move_ranks = [card_rank(c) for c in move.cards]

    # Playing single from a pair
    if move_type == MoveType.SINGLE:
        single_rank = move_ranks[0]
        if single_rank in hand_analysis['pairs']:
            return True

        # Check if breaking a triple
        if single_rank in hand_analysis['triples']:
            return True

        # Check if breaking a straight
        for straight in hand_analysis['straights']:
            if any(c in move_cards for c in straight):
                return True

        # Check if breaking a flush
        for flush in hand_analysis['flushes']:
            if any(c in move_cards for c in flush):
                return True

    # Playing pair from triple
    if move_type == MoveType.PAIR:
        pair_rank = move_ranks[0]
        if pair_rank in hand_analysis['triples']:
            return True

    return False


# =============================================================================
# Phase 2: Scoring System
# =============================================================================

def has_high_card(move) -> bool:
    """Check if move contains high cards (K, A, 2)."""
    if move.is_pass():
        return False

    return any(card_rank(c) >= 10 for c in move.cards)


def max_rank_in_move(move) -> int:
    """Get highest rank in move."""
    if move.is_pass():
        return -1

    return max(card_rank(c) for c in move.cards)


def would_waste_combo(legal_moves: List, hand_analysis: dict) -> bool:
    """Check if best available play would waste a valuable combo."""
    non_pass = [m for m in legal_moves if not m.is_pass()]

    if not non_pass:
        return False

    # Check if any non-pass move would break a combo
    for move in non_pass:
        if breaks_combination(move, hand_analysis):
            return True

    return False


def score_pass(game_state: dict) -> float:
    """
    Score the pass decision.

    Returns:
        Score for passing (higher = better to pass)
    """
    score = 0.0

    # Pass gets base score
    score += 20.0

    # Bonus if last move was strong
    last_strength = evaluate_last_move_strength(game_state)
    score += last_strength * 30.0

    # Bonus if we have many cards (conservative play)
    if game_state['hand_size'] > 8:
        score += 20.0

    return score


def score_move(move, hand_analysis: dict, game_state: dict) -> float:
    """
    Score a move based on multiple strategic factors.

    Returns:
        Score for the move (higher = better)
    """
    if move.is_pass():
        return score_pass(game_state)

    score = 0.0
    move_type = detect_move_type(move.cards)

    # Factor 1: Prefer playing low cards early/mid game (dominant factor)
    avg_rank = sum(card_rank(c) for c in move.cards) / len(move.cards)
    score += (12 - avg_rank) * 15  # Increased to make this the primary driver

    # Factor 2: Preserve valuable combinations (reduced significantly)
    if breaks_combination(move, hand_analysis):
        score -= 15  # Reduced from 35 - less combo preservation

    # Factor 3: Prefer multi-card plays to reduce hand size faster
    score += len(move.cards) * 3  # Reduced from 4

    # Factor 4: End-game urgency (few cards left)
    if game_state['hand_size'] <= 3:
        score += 50  # Reduced from 80

    # Factor 5: Avoid wasting power cards on weak plays
    last_strength = evaluate_last_move_strength(game_state)
    if has_high_card(move) and last_strength < 0.5:
        score -= 10  # Reduced from 20

    # Factor 6: Bonus for playing strong combos (straights, flushes, etc.)
    if move_type in [MoveType.STRAIGHT, MoveType.FLUSH, MoveType.FULL_HOUSE,
                     MoveType.QUAD_WITH_KICKER, MoveType.STRAIGHT_FLUSH]:
        score += 20  # Reduced from 30

    # Factor 7: When opponent is close to winning, play aggressively
    if game_state['min_opponent_cards'] <= 2:
        score += 25  # Reduced from 40

    return score


# =============================================================================
# Phase 3: Decision Logic
# =============================================================================

def should_pass(legal_moves: List, game_state: dict, hand_analysis: dict) -> bool:
    """
    Decide whether to pass based on game state.

    Returns:
        True if should pass, False if should play
    """
    # Never pass if about to win (<=2 cards)
    if game_state['hand_size'] <= 2:
        return False

    # Never pass if we can win this turn
    non_pass = [m for m in legal_moves if not m.is_pass()]
    if any(len(m.cards) == game_state['hand_size'] for m in non_pass):
        return False

    # Pass if opponent is close to winning and we can't block effectively
    if game_state['min_opponent_cards'] <= 2:
        if non_pass:
            best_play = max(non_pass, key=lambda m: max_rank_in_move(m))
            if max_rank_in_move(best_play) < 9:  # Changed from 10 to 9 (less likely to pass)
                return True

    # Pass if we'd waste a valuable combo on a strong play
    last_strength = evaluate_last_move_strength(game_state)
    if last_strength > 0.75:  # Changed from 0.7 to 0.75 (pass less often)
        if would_waste_combo(legal_moves, hand_analysis):
            return True

    # Pass conservatively in early game (>9 cards instead of >8)
    if game_state['hand_size'] > 9:  # Changed from 8 to 9
        if last_strength > 0.55:  # Changed from 0.5 to 0.55
            return True

    return False


def select_best_move(legal_moves: List, hand: List[int], game_state: dict):
    """
    Select optimal move based on strategic heuristics.

    Returns:
        Best move to play
    """
    # Analyze hand
    hand_analysis = analyze_hand_composition(hand)

    # Check if we should pass
    pass_move = next((m for m in legal_moves if m.is_pass()), None)
    if pass_move and should_pass(legal_moves, game_state, hand_analysis):
        return pass_move

    # Score all non-pass moves
    non_pass_moves = [m for m in legal_moves if not m.is_pass()]
    if not non_pass_moves:
        return pass_move

    # Score each move
    move_scores = [(m, score_move(m, hand_analysis, game_state)) for m in non_pass_moves]

    # Select highest scoring move
    best_move = max(move_scores, key=lambda x: x[1])[0]

    return best_move
