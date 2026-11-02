"""Fixed-shape Big 2 simulation for jit/vmap. Actions index the original hand.

Enumerate every subset of size 1/2/3/5 once per deal (plus pass), then mask
invalid and already-played subsets. No truncation of the legal action set.
step assumes a legal action, just like the reference engine. Done is absorbing.
"""

from itertools import combinations
from typing import NamedTuple

import jax
import jax.numpy as jnp
import numpy as np

from big2_ai.env.move_detector import STRAIGHT_RANKS

_subsets = [()] + [c for n in (1, 2, 3, 5) for c in combinations(range(13), n)]
SLOTS = np.array([list(c) + [0] * (5 - len(c)) for c in _subsets], np.int32)
SIZES = np.array([len(c) for c in _subsets], np.int32)
VALID_SLOTS = np.arange(5)[None, :] < SIZES[:, None]
SLOT_MASK = np.array([sum(1 << i for i in c) for c in _subsets], np.int32)
NUM_ACTIONS = len(_subsets)


class State(NamedTuple):
    deal: jax.Array
    remaining: jax.Array
    types: jax.Array
    values: jax.Array
    player: jax.Array
    first: jax.Array
    trick_type: jax.Array
    trick_value: jax.Array
    trick_cards: jax.Array
    trick_owner: jax.Array
    passes: jax.Array
    played: jax.Array
    recent: jax.Array
    done: jax.Array
    winner: jax.Array


def classify(hand):
    cards = hand[SLOTS]
    ranks = cards // 4
    valid = jnp.asarray(VALID_SLOTS)
    counts = jnp.sum((ranks[:, :, None] == jnp.arange(13)) & valid[:, :, None], axis=1)
    rank_bits = jnp.sum(jnp.where(counts > 0, 1 << jnp.arange(13), 0), axis=1)
    straight_bits = jnp.array([sum(1 << r for r in run) for run in STRAIGHT_RANKS])
    straight = jnp.max(jnp.where(rank_bits[:, None] == straight_bits, jnp.arange(11), -1), axis=1)
    flush = jnp.all(cards % 4 == cards[:, :1] % 4, axis=1)
    same = jnp.max(counts, axis=1) == SIZES
    full = jnp.any(counts == 3, axis=1) & jnp.any(counts == 2, axis=1)
    quad = jnp.any(counts == 4, axis=1)
    five = jnp.where(straight >= 0, jnp.where(flush, 8, 4),
                     jnp.where(flush, 5, jnp.where(full, 6, jnp.where(quad, 7, 9))))
    types = jnp.where(SIZES == 0, 0, jnp.where(SIZES == 1, 1,
             jnp.where(SIZES == 5, five, jnp.where(same, SIZES, 9))))
    high = jnp.max(jnp.where(valid, cards, -1), axis=1)
    group_rank = jnp.argmax(counts, axis=1)
    group_high = jnp.max(jnp.where(valid & (ranks == group_rank[:, None]), cards, -1), axis=1)
    values = jnp.where((types == 4) | (types == 8), straight * 4 + high % 4,
                       jnp.where((types == 6) | (types == 7), group_high, high))
    return types, values


def from_deal(deal):
    """Construct from a (4,13) permutation of 0..51; also useful for parity tests."""
    deal = jnp.sort(jnp.asarray(deal, dtype=jnp.int32), axis=1)
    types, values = jax.vmap(classify)(deal)
    return State(deal, jnp.full(4, 8191, jnp.int32), types, values,
                 jnp.argmin(jnp.min(deal, axis=1)).astype(jnp.int32),
                 jnp.array(True), jnp.int32(0), jnp.int32(-1),
                 jnp.zeros(52, bool), jnp.int32(0), jnp.int32(0),
                 jnp.zeros((4, 52), bool), jnp.zeros((4, 52), bool),
                 jnp.array(False), jnp.int32(-1))


def reset(key):
    return from_deal(jax.random.permutation(key, 52).reshape(4, 13))


def legal_mask(s):
    types, values = s.types[s.player], s.values[s.player]
    available = (s.remaining[s.player] & SLOT_MASK) == SLOT_MASK
    contains_zero = jnp.any((s.deal[s.player][SLOTS] == 0) & VALID_SLOTS, axis=1)
    lengths = jnp.array([0, 1, 2, 3, 5, 5, 5, 5, 5, -1])
    beats = (lengths[types] == lengths[s.trick_type]) & (
        (types > s.trick_type) | ((types == s.trick_type) & (values > s.trick_value)))
    legal = available & (types > 0) & (types < 9)
    legal &= jnp.where(s.first, contains_zero, (s.trick_type == 0) | beats)
    legal = legal.at[0].set(~s.first & (s.trick_type != 0))
    return legal & ~s.done


def action_cards(s, action):
    cards = s.deal[s.player][jnp.asarray(SLOTS)[action]]
    valid = jnp.asarray(VALID_SLOTS)[action]
    return jnp.any(jax.nn.one_hot(cards, 52, dtype=bool) & valid[:, None], axis=0)


def step(s, action):
    def advance(s):
        is_pass = action == 0
        cards = action_cards(s, action)
        remaining = s.remaining.at[s.player].set(s.remaining[s.player] & ~jnp.asarray(SLOT_MASK)[action])
        passes = jnp.where(is_pass, s.passes + 1, 0)
        clear = passes == 3
        done = remaining[s.player] == 0
        return State(s.deal, remaining, s.types, s.values, (s.player + 1) % 4,
                     s.first & is_pass,
                     jnp.where(clear, 0, jnp.where(is_pass, s.trick_type, s.types[s.player, action])),
                     jnp.where(clear, -1, jnp.where(is_pass, s.trick_value, s.values[s.player, action])),
                     jnp.where(clear, False, jnp.where(is_pass, s.trick_cards, cards)),
                     jnp.where(is_pass, s.trick_owner, s.player), jnp.where(clear, 0, passes),
                     s.played.at[s.player].set(s.played[s.player] | cards),
                     jnp.concatenate([s.recent[1:], cards[None]], axis=0),
                     done, jnp.where(done, s.player, -1))
    return jax.lax.cond(s.done, lambda s: s, advance, s)


def hand_counts(s):
    return jax.lax.population_count(s.remaining.astype(jnp.uint32)).astype(jnp.int32)


def rewards(s):
    counts = hand_counts(s)
    result = jnp.where(jnp.arange(4) == s.winner, .8 + .2 * counts.sum() / 39,
                       -.8 - .2 * counts / 13)
    return jnp.where(s.done, result, 0.)


def encode_state(s):
    p = s.player
    own_slots = (s.remaining[p] & (1 << jnp.arange(13))) != 0
    hand = jnp.any(jax.nn.one_hot(s.deal[p], 52, dtype=bool) & own_slots[:, None], axis=0)
    opponents = (p + jnp.arange(1, 4)) % 4
    trick = s.trick_type != 0
    return jnp.concatenate([
        hand, ~(hand | s.played.any(axis=0)), s.played[opponents].reshape(-1),
        s.trick_cards, jax.nn.one_hot((s.trick_owner - p) % 4, 4) * trick,
        jax.nn.one_hot(s.passes, 3) * trick,
        jax.nn.one_hot(hand_counts(s)[opponents] - 1, 13).reshape(-1),
        s.recent.reshape(-1),
    ]).astype(jnp.uint8)
