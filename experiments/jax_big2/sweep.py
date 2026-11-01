"""Fixed-best-policy rollout sweep and separate synthetic Adam update benchmark."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import jax
import jax.numpy as jnp
import numpy as np
from . import env
from .policy import choose_actions, load_weights, scores


def make_rollout(steps, capacity):
    @jax.jit
    def rollout(states, key, params):
        def body(_, carry):
            states, key, games, overflows, legal_sum, legal_max = carry
            key, reset_key, policy_key = jax.random.split(key, 3)
            keys = jax.random.split(reset_key, states.player.shape[0])
            states = jax.vmap(lambda s, k: jax.lax.cond(s.done, env.reset, lambda _: s, k))(states, keys)
            actions, counts, overflow = choose_actions(params, states, policy_key, capacity)
            states = jax.vmap(env.step)(states, actions)
            return (states, key, games + states.done.sum(), overflows + overflow.sum(),
                    legal_sum + counts.sum(), jnp.maximum(legal_max, counts.max()))
        return jax.lax.fori_loop(0, steps, body, (states, key, *[jnp.int32(0)] * 4))
    return rollout


def learner_benchmark(params, batch, updates):
    import optax
    # Throughput only: synthetic resident examples, no learning-quality claim.
    rng = np.random.default_rng(42)
    states = jnp.asarray(rng.integers(0, 2, (batch, 566)).astype(np.float32))
    moves = jnp.asarray(rng.integers(0, 2, (batch, 61)).astype(np.float32))
    targets = jnp.asarray(rng.uniform(-1, 1, batch).astype(np.float32))
    optimizer = optax.chain(optax.clip_by_global_norm(1.), optax.adam(3e-4))
    initial = optimizer.init(params)

    @jax.jit
    def run(p, opt):
        def body(_, carry):
            p, opt, _ = carry
            loss, grads = jax.value_and_grad(lambda p: jnp.mean((scores(p, states, moves) - targets)**2))(p)
            delta, opt = optimizer.update(grads, opt, p)
            return optax.apply_updates(p, delta), opt, loss
        return jax.lax.fori_loop(0, updates, body, (p, opt, jnp.float32(0)))
    start = time.perf_counter()
    jax.block_until_ready(run(params, initial))
    warmup = time.perf_counter() - start
    start = time.perf_counter()
    result = jax.block_until_ready(run(params, initial))
    elapsed = time.perf_counter() - start
    loss = float(result[2])
    if not np.isfinite(loss):
        raise RuntimeError('Non-finite learner loss')
    return dict(kind='synthetic_learner', batch=batch, updates=updates,
                compile_and_warmup_seconds=warmup, seconds=elapsed,
                samples_per_second=batch * updates / elapsed, final_loss=loss)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', default='models/selfplay_v1.npz')
    parser.add_argument('--batch-sizes', nargs='+', type=int, default=[64, 256, 1024])
    parser.add_argument('--capacities', nargs='+', type=int, default=[32, 64, 128])
    parser.add_argument('--steps', type=int, default=64)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--learner-batches', nargs='*', type=int, default=[512, 1024, 2048, 4096])
    parser.add_argument('--updates', type=int, default=50)
    parser.add_argument('--allow-cpu', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('results/policy-sweep.json'))
    args = parser.parse_args()
    if min(args.batch_sizes + args.capacities + args.learner_batches + [args.steps, args.repeats, args.updates]) < 1:
        parser.error('Sizes and iteration counts must be positive')
    if max(args.capacities) > env.NUM_ACTIONS:
        parser.error('Capacity exceeds the action space')
    if not args.allow_cpu and jax.default_backend() != 'gpu':
        parser.error('GPU required; use --allow-cpu only for local smoke testing')
    jax.config.update('jax_default_matmul_precision', 'highest')
    params = load_weights(args.weights)
    report = dict(jax=jax.__version__, devices=[str(x) for x in jax.devices()],
                  weights_sha256=hashlib.sha256(Path(args.weights).read_bytes()).hexdigest(),
                  precision='highest', epsilon=.01, seed=42, steps=args.steps,
                  repeats=args.repeats, runs=[])
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def record(row):
        report['runs'].append(row)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(row), flush=True)

    print(json.dumps({k: v for k, v in report.items() if k != 'runs'}), flush=True)
    for batch in args.batch_sizes:
        for capacity in args.capacities:
            # Identical initial deals and key stream across capacities.
            print(f'Running batch={batch}, capacity={capacity}', flush=True)
            key = jax.random.PRNGKey(42)
            start = time.perf_counter()
            states = jax.block_until_ready(jax.jit(jax.vmap(env.reset))(jax.random.split(key, batch)))
            rollout = make_rollout(args.steps, capacity)
            warmed = jax.block_until_ready(rollout(states, key, params))
            warmup = time.perf_counter() - start
            states, key = warmed[:2]
            totals = np.zeros(3, np.int64)
            maximum = 0
            times = []
            for _ in range(args.repeats):
                start = time.perf_counter()
                result = jax.block_until_ready(rollout(states, key, params))
                times.append(time.perf_counter() - start)
                states, key = result[:2]
                totals += np.array([int(x) for x in result[2:5]])
                maximum = max(maximum, int(result[5]))
            decisions = batch * args.steps * args.repeats
            record(dict(kind='fixed_policy_rollout', batch=batch, capacity=capacity,
                        compile_and_warmup_seconds=warmup, repeat_seconds=times,
                        decisions_per_second=decisions / sum(times), games_per_second=int(totals[0]) / sum(times),
                        overflow_fraction=int(totals[1]) / decisions,
                        mean_legal_moves=int(totals[2]) / decisions, max_legal_moves=maximum))
            del rollout, warmed, result, states
            jax.clear_caches()
    for batch in args.learner_batches:
        record(learner_benchmark(params, batch, args.updates))
        jax.clear_caches()
    rows = [r for r in report['runs'] if r['kind'] == 'fixed_policy_rollout']
    best = max(rows, key=lambda r: r['decisions_per_second'])
    print(f"Fastest measured rollout: batch={best['batch']}, capacity={best['capacity']}. "
          'Rerun the top configurations longer before choosing production settings.', flush=True)


if __name__ == '__main__':
    main()
