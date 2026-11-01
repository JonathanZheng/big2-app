"""Environment-only random-policy throughput, including reset and encoding.

Run from the repository root: python -m experiments.jax_big2.benchmark.
Compilation is reported separately; timing always synchronizes the device.
"""

import argparse
import json
import platform
import random
import time
from pathlib import Path

import jax
import jax.numpy as jnp

from big2_ai.env.game import Big2Game
from big2_ai.env.move_generator import get_legal_moves
from big2_ai.env.selfplay_encoding import encode_state
from . import env


def make_rollout(steps):
    def one(s, key):
        reset_key, action_key = jax.random.split(key)
        s = jax.lax.cond(s.done, lambda _: env.reset(reset_key), lambda _: s, None)
        observation = env.encode_state(s)
        mask = env.legal_mask(s)
        # IID uniform scores give a uniform choice among legal actions.
        action = jnp.argmax(jnp.where(mask, jax.random.uniform(action_key, (env.NUM_ACTIONS,)), -1))
        next_state = env.step(s, action)
        return next_state, next_state.done.astype(jnp.int32), observation.sum(dtype=jnp.int32)

    @jax.jit
    def rollout(states, key):
        def body(_, carry):
            states, key, games, checksum = carry
            key, subkey = jax.random.split(key)
            states, ended, observed = jax.vmap(one)(states, jax.random.split(subkey, states.player.shape[0]))
            return states, key, games + ended.sum(), checksum + observed.sum()
        return jax.lax.fori_loop(0, steps, body, (states, key, jnp.int32(0), jnp.int32(0)))
    return rollout


def python_baseline(seconds, seed):
    random.seed(seed)
    game = Big2Game()
    start = time.perf_counter()
    decisions = games = checksum = 0
    while time.perf_counter() - start < seconds:
        if game.done:
            game.reset()
        checksum += int(encode_state(game, game.current_player).sum())
        game.step(random.choice(get_legal_moves(game, game.current_player)))
        decisions += 1
        games += int(game.done)
    elapsed = time.perf_counter() - start
    return dict(seconds=elapsed, decisions_per_second=decisions / elapsed,
                games_per_second=games / elapsed, checksum=checksum, workers=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-sizes", type=int, nargs="+", default=[1, 16, 64, 256])
    parser.add_argument("--steps", type=int, default=128)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--baseline-seconds", type=float, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--require-gpu", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if min(args.batch_sizes + [args.steps, args.repeats]) <= 0 or args.baseline_seconds <= 0:
        parser.error("Batch sizes, steps, repeats and baseline seconds must be positive")
    if args.require_gpu and jax.default_backend() != "gpu":
        parser.error(f"GPU required, but active backend is {jax.default_backend()}")
    report = dict(kind="environment_only_random_policy", jax=jax.__version__,
                  platform=platform.platform(), devices=[str(d) for d in jax.devices()],
                  seed=args.seed, steps=args.steps, repeats=args.repeats,
                  python=python_baseline(args.baseline_seconds, args.seed), runs=[])
    print(json.dumps(report), flush=True)
    rollout = make_rollout(args.steps)
    reset_batch = jax.jit(jax.vmap(env.reset))
    for batch in args.batch_sizes:
        key = jax.random.PRNGKey(args.seed)
        start = time.perf_counter()
        states = jax.block_until_ready(reset_batch(jax.random.split(key, batch)))
        warmed = jax.block_until_ready(rollout(states, key))
        compile_seconds = time.perf_counter() - start
        states, key = warmed[:2]
        games = checksum = 0
        start = time.perf_counter()
        for _ in range(args.repeats):
            states, key, ended, observed = jax.block_until_ready(rollout(states, key))
            games += int(ended)
            checksum += int(observed)
        elapsed = time.perf_counter() - start
        result = dict(batch=batch, compile_and_warmup_seconds=compile_seconds,
                      seconds=elapsed, decisions_per_second=batch * args.steps * args.repeats / elapsed,
                      completed_games=games, games_per_second=games / elapsed, checksum=checksum)
        report["runs"].append(result)
        print(json.dumps(result), flush=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
