from pathlib import Path
import numpy as np
import pytest
jax = pytest.importorskip('jax')
import jax.numpy as jnp
from experiments.jax_big2 import env
from experiments.jax_big2.policy import load_weights, scores, choose_actions

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def params():
    path = ROOT / 'models/selfplay_v1.npz'
    if not path.exists():
        pytest.skip('Run python -m experiments.jax_big2.export first')
    return load_weights(path)


def test_torch_score_parity(params):
    with np.load(ROOT / 'experiments/jax_big2/fixtures/torch_scores.npz') as data:
        with jax.default_matmul_precision('highest'):
            actual = jax.jit(scores)(params, jnp.asarray(data['states']), jnp.asarray(data['moves']))
        np.testing.assert_allclose(actual, data['scores'], rtol=2e-5, atol=2e-6)


def test_compaction_overflow_matches_full_scoring(params):
    # 13 diamonds gives many legal flushes on the opening turn.
    hand = list(range(0, 52, 4))
    rest = [c for c in range(52) if c not in hand]
    deal = np.array([hand, rest[:13], rest[13:26], rest[26:]])
    state = jax.jit(env.from_deal)(deal)
    states = jax.tree_util.tree_map(lambda x: x[None], state)
    key = jax.random.PRNGKey(42)
    with jax.default_matmul_precision('highest'):
        full, counts, _ = jax.jit(lambda p, s: choose_actions(p, s, key, env.NUM_ACTIONS, 0))(params, states)
        small, _, overflow = jax.jit(lambda p, s: choose_actions(p, s, key, 32, 0))(params, states)
    assert int(counts[0]) > 32
    assert bool(overflow[0])
    np.testing.assert_array_equal(small, full)
    assert bool(jax.jit(env.legal_mask)(state)[int(small[0])])


def test_nonoverflow_and_exploration_are_legal(params):
    states = jax.jit(jax.vmap(env.reset))(jax.random.split(jax.random.PRNGKey(3), 4))
    for epsilon in (0., 1.):
        actions, _, _ = jax.jit(lambda p, s: choose_actions(p, s, jax.random.PRNGKey(5), 128, epsilon))(params, states)
        mask = np.asarray(jax.jit(jax.vmap(env.legal_mask))(states))
        assert mask[np.arange(4), np.asarray(actions)].all()
