import numpy as np
import pytest
jax = pytest.importorskip('jax')
pytest.importorskip('optax')
import jax.numpy as jnp
from experiments.jax_big2 import env
from experiments.jax_big2.policy import load_weights
from experiments.jax_big2.train import make_collect, make_learn, optimizer_for, save_checkpoint, restore_checkpoint
from big2_ai.env.game import Big2Game, Move
from big2_ai.env.move_generator import get_legal_moves
from big2_ai.env.selfplay_encoding import encode_state
from pathlib import Path


@pytest.fixture
def setup():
    params = load_weights(Path(__file__).resolve().parents[1] / 'models/selfplay_v1.npz')
    config = dict(num_envs=2, capacity=32, epsilon=.01, batch_size=32, learning_rate=3e-4, grad_clip=1.)
    return params, config


def test_complete_rollout_returns_match_python(setup):
    params, config = setup
    key = jax.random.PRNGKey(19)
    collect = make_collect(2, 32, .01).lower(params, key).compile()
    batch = jax.block_until_ready(collect(params, key))
    _, obs, moves, targets, valid, metrics = jax.device_get(batch)
    _, deal_key = jax.random.split(key)
    initial = jax.jit(jax.vmap(env.reset))(jax.random.split(deal_key, 2))
    assert metrics['games'] == 2
    for lane in range(2):
        game = Big2Game(seed=0)
        game.hands = np.asarray(initial.deal[lane]).tolist()
        game.current_player = int(initial.player[lane])
        players = []
        for t in np.flatnonzero(valid[:, lane]):
            assert not game.done
            np.testing.assert_array_equal(obs[t, lane], encode_state(game, game.current_player))
            cards = np.flatnonzero(moves[t, lane, :52]).tolist()
            assert tuple(cards) in {tuple(sorted(m.cards)) for m in get_legal_moves(game, game.current_player)}
            players.append(game.current_player)
            game.step(Move(cards, game.current_player))
        assert game.done
        expected = np.asarray(game.compute_rewards())[players]
        np.testing.assert_allclose(targets[valid[:, lane], lane], expected, rtol=1e-6)
    opt = optimizer_for(config).init(params)
    learn = make_learn(config)
    updated = jax.block_until_ready(learn(params, opt, batch[0], *batch[1:5]))
    assert bool(updated[5])
    assert int(updated[4]) == (int(valid.sum()) + 31) // 32
    assert any(not np.array_equal(a, b) for a, b in zip(jax.tree_util.tree_leaves(params), jax.tree_util.tree_leaves(updated[0])))


def test_masked_samples_and_resume(tmp_path, setup):
    params, config = setup
    key = jax.random.PRNGKey(7)
    optimizer = optimizer_for(config)
    opt = optimizer.init(params)
    learn = make_learn(config)
    # Fewer valid examples than a minibatch: padding must not dilute gradients.
    x = jnp.zeros((1, 5, 566), jnp.uint8)
    a = jnp.zeros((1, 5, 61), jnp.uint8)
    y = jnp.ones((1, 5))
    valid = jnp.array([[True, True, False, False, False]])
    first = jax.block_until_ready(learn(params, opt, key, x, a, y, valid))
    poisoned = jax.block_until_ready(learn(params, opt, key, x.at[:, 2:].set(1), a.at[:, 2:].set(1), y.at[:, 2:].set(99), valid))
    for expected, actual in zip(jax.tree_util.tree_leaves(first), jax.tree_util.tree_leaves(poisoned)):
        np.testing.assert_array_equal(expected, actual)
    path = tmp_path / 'latest.npz'
    save_checkpoint(path, first[0], first[1], first[2], config, dict(games=2))
    restored = restore_checkpoint(path)
    assert restored[3:] == (config, dict(games=2))
    next_original = jax.block_until_ready(learn(*first[:3], x, a, y, valid))
    next_restored = jax.block_until_ready(learn(*restored[:3], x, a, y, valid))
    for expected, actual in zip(jax.tree_util.tree_leaves(next_original), jax.tree_util.tree_leaves(next_restored)):
        np.testing.assert_array_equal(expected, actual)
    empty = jax.block_until_ready(learn(params, opt, key, x, a, y, jnp.zeros_like(valid)))
    assert int(empty[4]) == 0
    for expected, actual in zip(jax.tree_util.tree_leaves(params), jax.tree_util.tree_leaves(empty[0])):
        np.testing.assert_array_equal(expected, actual)
