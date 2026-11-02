"""Differential checks against the production rules and observation encoding."""

import random

import numpy as np
import pytest

jax = pytest.importorskip("jax")
from big2_ai.env.game import Big2Game
from big2_ai.env.move_generator import get_legal_moves
from big2_ai.env.move_detector import detect_move_type, get_move_value
from big2_ai.env.selfplay_encoding import encode_state
from experiments.jax_big2 import env

init = jax.jit(env.from_deal)
legal = jax.jit(env.legal_mask)
advance = jax.jit(env.step)
observe = jax.jit(env.encode_state)


def action_tuple(state, action):
    hand = np.asarray(state.deal)[int(state.player)]
    return tuple(sorted(hand[env.SLOTS[action, :env.SIZES[action]]].tolist()))


@pytest.mark.parametrize("seed", range(12))
def test_complete_game_parity(seed):
    game = Big2Game(seed=seed)
    state = init(np.array(game.hands))
    rng = random.Random(seed)
    for _ in range(208):
        assert int(state.player) == game.current_player
        assert bool(state.first) == game.first_move
        assert int(state.passes) == game.passes_since_last_move
        np.testing.assert_array_equal(env.hand_counts(state), list(map(len, game.hands)))
        np.testing.assert_array_equal(observe(state), encode_state(game, game.current_player))
        reference = {tuple(sorted(m.cards)): m for m in get_legal_moves(game, game.current_player)}
        actual = {action_tuple(state, a): a for a in np.flatnonzero(np.asarray(legal(state)))}
        assert actual.keys() == reference.keys()
        cards = rng.choice(list(reference))
        game.step(reference[cards])
        state = advance(state, actual[cards])
        assert bool(state.done) == game.done
        if game.done:
            assert int(state.winner) == game.winner
            np.testing.assert_allclose(env.rewards(state), game.compute_rewards(), rtol=1e-6)
            assert not np.asarray(legal(state)).any()
            after = advance(state, 0)
            for before_leaf, after_leaf in zip(state, after):
                np.testing.assert_array_equal(before_leaf, after_leaf)
            return
    pytest.fail("Game did not terminate")


@pytest.mark.parametrize("hand", [
    list(range(0, 52, 4)),  # all flushes and all eleven straight runs
    list(range(13)),      # pairs, triples, full houses, quads
    [0, 5, 10, 15, 20, 25, 30, 35, 36, 41, 46, 48, 51],
])
def test_every_subset_classification(hand):
    types, values = map(np.asarray, jax.jit(env.classify)(np.array(hand)))
    for action, size in enumerate(env.SIZES):
        cards = [hand[i] for i in env.SLOTS[action, :size]]
        kind = detect_move_type(cards)
        assert types[action] == kind.value
        if 0 < kind.value < 9:
            rank, suit = get_move_value(cards, kind)
            assert values[action] == rank * 4 + suit


def test_batched_reset_and_step():
    states = jax.jit(jax.vmap(env.reset))(jax.random.split(jax.random.PRNGKey(7), 4))
    masks = jax.jit(jax.vmap(env.legal_mask))(states)
    actions = np.argmax(masks, axis=1)
    updated = jax.jit(jax.vmap(env.step))(states, actions)
    np.testing.assert_array_equal(updated.player, (np.asarray(states.player) + 1) % 4)
    assert np.all(np.asarray(jax.vmap(env.hand_counts)(updated)).sum(axis=1) < 52)
