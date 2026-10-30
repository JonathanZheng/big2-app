"""House straight rules: 3-4-5-6-7 < ... < 10-J-Q-K-A < J-Q-K-A-2 < 2-3-4-5-6 < A-2-3-4-5."""

from big2_ai.env.game import Big2Game, Move
from big2_ai.env.move_detector import detect_move_type, can_beat, MoveType
from big2_ai.env.move_generator import get_legal_moves

RANKS = {'3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7,
         'J': 8, 'Q': 9, 'K': 10, 'A': 11, '2': 12}
SUITS = {'d': 0, 'c': 1, 'h': 2, 's': 3}


def cards(text):
    return [RANKS[c[:-1]] * 4 + SUITS[c[-1]] for c in text.split()]


def test_wraparound_straights_are_straights():
    assert detect_move_type(cards('Jd Qc Kh As 2d')) == MoveType.STRAIGHT
    assert detect_move_type(cards('2d 3c 4h 5s 6d')) == MoveType.STRAIGHT
    assert detect_move_type(cards('Ad 2c 3h 4s 5d')) == MoveType.STRAIGHT


def test_other_wraparounds_are_not_straights():
    assert detect_move_type(cards('Qd Kc Ah 2s 3d')) == MoveType.INVALID
    assert detect_move_type(cards('Kd Ac 2h 3s 4d')) == MoveType.INVALID


def test_straight_order():
    order = ['3d 4c 5h 6s 7d', '9d 10c Jh Qs Kd', '10d Jc Qh Ks Ad',
             'Jd Qc Kh As 2d', '2d 3c 4h 5s 6d', 'Ad 2c 3h 4s 5d']
    for lower, higher in zip(order, order[1:]):
        assert can_beat(cards(higher), cards(lower)), (higher, lower)
        assert not can_beat(cards(lower), cards(higher)), (lower, higher)


def test_same_run_compares_suit_of_the_two():
    assert can_beat(cards('Ad 2s 3d 4d 5c'), cards('As 2h 3s 4s 5s'))
    assert can_beat(cards('2s 3d 4d 5d 6c'), cards('2h 3s 4s 5s 6s'))
    assert not can_beat(cards('2c 3s 4s 5s 6s'), cards('2h 3d 4d 5d 6c'))


def test_straight_flush_order():
    low = cards('10s Js Qs Ks As')
    high = cards('Ad 2d 3d 4d 5d')
    assert detect_move_type(high) == MoveType.STRAIGHT_FLUSH
    assert can_beat(high, low)
    assert not can_beat(low, high)


def _game_with_hand(hand, last=None):
    game = Big2Game(seed=0)
    game.hands[0] = sorted(hand)
    game.current_player = 0
    game.first_move = last is None and 0 in hand
    game.last_move = Move(last, 1) if last else None
    return game


def _legal(game):
    return [sorted(m.cards) for m in get_legal_moves(game, 0)]


def test_wraparound_straights_can_open_the_game():
    game = _game_with_hand(cards('3d Ac 2h 4s 5d 6c 9h'))
    legal = _legal(game)
    assert sorted(cards('Ac 2h 3d 4s 5d')) in legal
    assert sorted(cards('2h 3d 4s 5d 6c')) in legal
    assert all(0 in m for m in legal)


def test_generator_offers_wraparound_straights_when_leading():
    game = _game_with_hand(cards('Ac 2h 3c 4s 5h Jd Qd Kc'))
    legal = _legal(game)
    assert sorted(cards('Ac 2h 3c 4s 5h')) in legal
    assert sorted(cards('Jd Qd Kc Ac 2h')) in legal


def test_generator_beats_with_higher_wraparound_only():
    game = _game_with_hand(cards('2h 3c 4s 5h 6d Ac'), last=cards('Jd Qc Kh As 2d'))
    legal = _legal(game)
    assert sorted(cards('2h 3c 4s 5h 6d')) in legal
    assert sorted(cards('Ac 2h 3c 4s 5h')) in legal

    game = _game_with_hand(cards('Jd Qc Kh As 2h 9c'), last=cards('2d 3c 4h 5s 6d'))
    assert _legal(game) == [[]]  # only pass


def test_generator_straight_flush_wraparound():
    game = _game_with_hand(cards('Ad 2d 3d 4d 5d 9c'), last=cards('10s Js Qs Ks As'))
    assert sorted(cards('Ad 2d 3d 4d 5d')) in _legal(game)


def test_random_games_only_generate_valid_moves():
    import random
    rng = random.Random(0)
    wraparounds = 0
    for seed in range(300):
        game = Big2Game(seed=seed)
        while not game.done:
            moves = get_legal_moves(game, game.current_player)
            assert moves
            seen = set()
            for m in moves:
                key = tuple(sorted(m.cards))
                assert key not in seen
                seen.add(key)
                if m.is_pass():
                    continue
                assert detect_move_type(m.cards) != MoveType.INVALID
                if game.first_move:
                    assert 0 in m.cards
                if game.last_move is not None:
                    assert can_beat(m.cards, game.last_move.cards)
                ranks = {c // 4 for c in m.cards}
                if len(m.cards) == 5 and {0, 12} <= ranks:
                    wraparounds += 1
            game.step(rng.choice(moves))
    assert wraparounds > 0


def test_four_of_a_kind_ranks_between_full_house_and_straight_flush():
    quad = cards('6d 6c 6h 6s 3h')
    assert detect_move_type(quad) == MoveType.QUAD_WITH_KICKER
    assert can_beat(quad, cards('9d 9c 9h 4s 4d'))
    assert can_beat(cards('7d 7c 7h 7s 3d'), quad)
    assert can_beat(cards('3s 4s 5s 6s 7s'), quad)
    assert not can_beat(quad, cards('3s 4s 5s 6s 7s'))
