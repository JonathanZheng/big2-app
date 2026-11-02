"""Inference with exported PyTorch weights and exact legal-action compaction."""
import jax
import jax.numpy as jnp
import numpy as np
from . import env


def load_weights(path):
    with np.load(path, allow_pickle=False) as archive:
        return {k: jnp.asarray(archive[k]) for k in archive.files}


def scores(p, states, moves):
    """Broadcast states (...,566) against moves (...,61). Weights retain torch layout."""
    x = jax.nn.relu(states @ p['state_in.weight'].T + p['state_in.bias']
                    + moves @ p['move_in.weight'].T)
    for name in ('fc2', 'fc3'):
        x = jax.nn.relu(x @ p[name + '.weight'].T + p[name + '.bias'])
    return (x @ p['out.weight'].T + p['out.bias'])[..., 0]


def encode_actions(s, actions):
    cards = jax.vmap(env.action_cards, in_axes=(None, 0))(s, actions)
    return jnp.concatenate([cards, jax.nn.one_hot(s.types[s.player, actions], 9)], axis=-1).astype(jnp.float32)


def choose_actions(p, states, key, capacity, epsilon=.01):
    masks = jax.vmap(env.legal_mask)(states)
    counts = masks.sum(axis=1)
    observations = jax.vmap(env.encode_state)(states).astype(jnp.float32)
    indices = jax.vmap(lambda m: jnp.nonzero(m, size=capacity, fill_value=0)[0])(masks)
    moves = jax.vmap(encode_actions)(states, indices)
    q = scores(p, observations[:, None, :], moves)
    q = jnp.where(jnp.arange(capacity)[None, :] < counts[:, None], q, -jnp.inf)
    actions = jnp.take_along_axis(indices, q.argmax(axis=1)[:, None], axis=1)[:, 0]
    overflow = counts > capacity

    # Scalar conditionals avoid evaluating a full padded network for every lane.
    # Rare overflowing lanes score ALL actions, never silently truncate moves.
    def correct(i, actions):
        def full(_):
            s = jax.tree_util.tree_map(lambda x: x[i], states)
            encoded = encode_actions(s, jnp.arange(env.NUM_ACTIONS))
            values = scores(p, observations[i], encoded)
            return actions.at[i].set(jnp.argmax(jnp.where(masks[i], values, -jnp.inf)))
        return jax.lax.cond(overflow[i], full, lambda _: actions, None)
    actions = jax.lax.cond(overflow.any(),
                           lambda a: jax.lax.fori_loop(0, counts.shape[0], correct, a),
                           lambda a: a, actions)
    explore_key, random_key = jax.random.split(key)
    random_actions = jnp.argmax(jnp.where(masks, jax.random.uniform(random_key, masks.shape), -1), axis=1)
    actions = jnp.where(jax.random.uniform(explore_key, counts.shape) < epsilon, random_actions, actions)
    return actions, counts, overflow
