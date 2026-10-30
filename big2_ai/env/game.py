"""Big 2 game engine with standard rules."""

import random
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass


# Card representation:
# Card = rank * 4 + suit
# Rank: 0=3, 1=4, 2=5, ..., 10=K, 11=A, 12=2
# Suit: 0=Diamonds, 1=Clubs, 2=Hearts, 3=Spades
# So 3♦ = 0*4 + 0 = 0

RANK_NAMES = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
SUIT_NAMES = ['♦', '♣', '♥', '♠']
SUIT_SYMBOLS = ['d', 'c', 'h', 's']


def card_rank(card: int) -> int:
    """Get rank of a card (0-12)."""
    return card // 4


def card_suit(card: int) -> int:
    """Get suit of a card (0-3)."""
    return card % 4


def card_to_str(card: int) -> str:
    """Convert card to readable string."""
    return f"{RANK_NAMES[card_rank(card)]}{SUIT_NAMES[card_suit(card)]}"


def cards_to_str(cards: List[int]) -> str:
    """Convert list of cards to readable string."""
    return '[' + ', '.join(card_to_str(c) for c in sorted(cards)) + ']'


@dataclass
class Move:
    """Represents a move in Big 2."""
    cards: List[int]  # Empty list means pass
    player: int

    def is_pass(self) -> bool:
        return len(self.cards) == 0

    def __repr__(self) -> str:
        if self.is_pass():
            return f"Move(PASS, player={self.player})"
        return f"Move({cards_to_str(self.cards)}, player={self.player})"


class Big2Game:
    """
    Big 2 game environment.

    Rules:
    - 52 cards, 4 players, 13 cards each
    - First move must contain 3♦
    - Move types: Single, Pair, Triple, Straight(5), Flush(5), Full House, Quad+Kicker, Straight Flush
    - Pass allowed after any non-pass move
    - Game ends when any player runs out of cards
    """

    def __init__(self, seed: Optional[int] = None, use_margin_rewards: bool = True):
        """
        Initialize game.

        Args:
            seed: Random seed for shuffling
            use_margin_rewards: If True, use margin-based rewards (default)
        """
        self.seed = seed
        self.use_margin_rewards = use_margin_rewards
        if seed is not None:
            random.seed(seed)

        self.reset()

    def reset(self) -> None:
        """Reset game to initial state."""
        # Create and shuffle deck
        deck = list(range(52))
        random.shuffle(deck)

        # Deal cards to players
        self.hands = [
            sorted(deck[0:13]),
            sorted(deck[13:26]),
            sorted(deck[26:39]),
            sorted(deck[39:52])
        ]

        # Find who has 3♦ (card 0)
        self.current_player = 0
        for i in range(4):
            if 0 in self.hands[i]:
                self.current_player = i
                break

        self.first_move = True
        self.last_move: Optional[Move] = None
        self.passes_since_last_move = 0
        self.done = False
        self.winner: Optional[int] = None
        self.move_history: List[Move] = []

    def get_hand(self, player: int) -> List[int]:
        """Get cards in a player's hand."""
        return self.hands[player].copy()

    def get_hand_size(self, player: int) -> int:
        """Get number of cards in a player's hand."""
        return len(self.hands[player])

    def step(self, move: Move) -> Tuple[None, float, bool, Dict]:
        """
        Execute a move and return (state, reward, done, info).

        Note: state is None (use get_state() methods instead)
        """
        assert not self.done, "Game is already over"
        assert move.player == self.current_player, f"Wrong player: expected {self.current_player}, got {move.player}"

        # For now, assume move is legal (will be validated by move_generator)
        if not move.is_pass():
            # Remove cards from hand
            for card in move.cards:
                self.hands[self.current_player].remove(card)

            # Update last move
            self.last_move = move
            self.passes_since_last_move = 0
            self.first_move = False

            # Check if player won
            if len(self.hands[self.current_player]) == 0:
                self.done = True
                self.winner = self.current_player
        else:
            # Pass
            self.passes_since_last_move += 1

            # If 3 consecutive passes, start new trick
            if self.passes_since_last_move >= 3:
                self.last_move = None
                self.passes_since_last_move = 0

        # Record move
        self.move_history.append(move)

        # Next player
        self.current_player = (self.current_player + 1) % 4

        # Compute rewards if game is done
        if self.done:
            rewards = self.compute_rewards(use_margin=self.use_margin_rewards)
            return None, rewards[move.player], True, {
                "all_rewards": rewards,
                "winner": self.winner
            }
        else:
            return None, 0.0, False, {}

    def compute_rewards(self, use_margin: bool = True) -> List[float]:
        """
        Compute final rewards for all players.

        Args:
            use_margin: If True, scale rewards with winning margin.
                        If False, use simple +1/-1 rewards.

        Returns:
            List of 4 rewards for each player.

        Margin-based rewards:
            - Winner: +0.8 base + up to +0.2 margin bonus (0.8 to 1.0)
            - Losers: -0.8 base - up to -0.2 penalty for cards remaining (-0.8 to -1.0)

        This incentivizes dominant wins while keeping winning as the primary goal.
        """
        assert self.done, "Game must be over to compute rewards"

        if not use_margin:
            # Original behavior: simple +1/-1
            rewards = [-1.0, -1.0, -1.0, -1.0]
            rewards[self.winner] = 1.0
            return rewards

        # Margin = cards left in losers' hands (0-39, where 39 = 3×13)
        total_loser_cards = sum(len(self.hands[i]) for i in range(4) if i != self.winner)
        margin = total_loser_cards / 39.0  # Normalized [0, 1]

        rewards = []
        for i in range(4):
            if i == self.winner:
                # Winner: +0.8 base + up to +0.2 margin bonus
                # Winning is 80% of the reward, margin is 20%
                rewards.append(0.8 + 0.2 * margin)
            else:
                # Loser: -0.8 base - up to -0.2 penalty for cards remaining
                cards_left = len(self.hands[i])
                rewards.append(-0.8 - 0.2 * (cards_left / 13.0))

        return rewards

    def get_legal_moves_simple(self) -> List[Move]:
        """
        Get legal moves for current player (simplified version).
        This is a placeholder - full implementation in move_generator.py
        """
        moves = []
        hand = self.hands[self.current_player]

        # First move must contain 3♦
        if self.first_move:
            # For now, just allow single 3♦
            if 0 in hand:
                moves.append(Move([0], self.current_player))
            return moves

        # Can always pass if not first move and last_move exists
        if self.last_move is not None:
            moves.append(Move([], self.current_player))

        # Can play any single card
        for card in hand:
            moves.append(Move([card], self.current_player))

        return moves

    def __repr__(self) -> str:
        """String representation of game state."""
        lines = [f"Big2Game(current_player={self.current_player}, done={self.done})"]
        for i in range(4):
            hand_str = cards_to_str(self.hands[i])
            marker = " ←" if i == self.current_player else ""
            lines.append(f"  Player {i}: {hand_str}{marker}")
        if self.last_move:
            lines.append(f"  Last move: {self.last_move}")
        return '\n'.join(lines)


def test_game():
    """Simple test of game mechanics."""
    print("Testing Big 2 game engine...")

    game = Big2Game(seed=42)
    print(game)
    print()

    # Play a few moves
    for _ in range(5):
        moves = game.get_legal_moves_simple()
        if not moves:
            break

        move = moves[0]  # Play first legal move
        print(f"Player {game.current_player} plays: {move}")
        _, reward, done, info = game.step(move)

        if done:
            print(f"\nGame over! Winner: Player {info['winner']}")
            print(f"Rewards: {info['all_rewards']}")
            break

    print("\nTest complete!")


if __name__ == "__main__":
    test_game()
