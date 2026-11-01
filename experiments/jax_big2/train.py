"""Synchronous all-seat Deep Monte Carlo self-play on JAX.

Each round finishes one game per lane using frozen parameters, then trains on
all valid decisions with final player rewards. No episode truncation or replay.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import time

import jax
import jax.numpy as jnp
import numpy as np
import optax

from . import env
from .policy import choose_actions, encode_actions, load_weights, scores

# At most 52 non-pass moves, with at most three passes between them.
# 208 is a conservative bound; reaching it without termination is an error.
MAX_TURNS = 208


def optimizer_for(config):
    return optax.chain(optax.clip_by_global_norm(config['grad_clip']),
                       optax.adam(config['learning_rate']))


def make_collect(num_envs, capacity, epsilon):
    @jax.jit
    def collect(params, key):
        key, deal_key = jax.random.split(key)
        states = jax.vmap(env.reset)(jax.random.split(deal_key, num_envs))
        observations = jnp.zeros((MAX_TURNS, num_envs, 566), jnp.uint8)
        moves = jnp.zeros((MAX_TURNS, num_envs, 61), jnp.uint8)
        players = jnp.zeros((MAX_TURNS, num_envs), jnp.int32)
        valid = jnp.zeros((MAX_TURNS, num_envs), bool)

        def condition(c):
            turn, states = c[:2]
            return (turn < MAX_TURNS) & ~states.done.all()

        def body(c):
            turn, states, key, observations, moves, players, valid, overflow_count = c
            key, action_key = jax.random.split(key)
            active = ~states.done
            actions, _, overflow = choose_actions(params, states, action_key, capacity, epsilon)
            observation = jax.vmap(env.encode_state)(states)
            encoded = jax.vmap(lambda s, a: encode_actions(s, a[None])[0])(states, actions)
            observations = observations.at[turn].set(observation)
            moves = moves.at[turn].set(encoded.astype(jnp.uint8))
            players = players.at[turn].set(states.player)
            valid = valid.at[turn].set(active)
            states = jax.vmap(env.step)(states, actions)
            return (turn + 1, states, key, observations, moves, players, valid,
                    overflow_count + (overflow & active).sum())

        turn, states, key, observations, moves, players, valid, overflow = jax.lax.while_loop(
            condition, body, (jnp.int32(0), states, key, observations, moves,
                             players, valid, jnp.int32(0)))
        terminal_rewards = jax.vmap(env.rewards)(states)
        targets = terminal_rewards[jnp.arange(num_envs)[None, :], players]
        return (key, observations, moves, targets, valid,
                dict(games=states.done.sum(), decisions=valid.sum(), turns=turn,
                     overflow=overflow, terminal_rewards=terminal_rewards,
                     players=players, winners=states.winner))
    return collect


def make_learn(config):
    optimizer = optimizer_for(config)
    batch_size = config['batch_size']

    @jax.jit
    def learn(params, opt_state, key, observations, moves, targets, valid):
        observations = observations.reshape(-1, 566)
        moves = moves.reshape(-1, 61)
        targets, valid = targets.reshape(-1), valid.reshape(-1)
        count = valid.sum()
        key, shuffle_key = jax.random.split(key)
        # Shuffle valid examples to the front; invalid slots are never learned.
        order = jnp.argsort(jnp.where(valid, jax.random.uniform(shuffle_key, valid.shape), 2.))
        pad = (-len(order)) % batch_size
        order = jnp.pad(order, (0, pad))
        updates = (count + batch_size - 1) // batch_size

        def body(i, carry):
            params, opt_state, loss_sum, finite = carry
            indices = jax.lax.dynamic_slice_in_dim(order, i * batch_size, batch_size)
            mask = jnp.arange(batch_size) + i * batch_size < count
            x, a, y = observations[indices].astype(jnp.float32), moves[indices].astype(jnp.float32), targets[indices]

            def loss_fn(p):
                residual = scores(p, x, a) - y
                return jnp.sum(jnp.where(mask, residual**2, 0.)) / jnp.maximum(mask.sum(), 1)
            loss, grads = jax.value_and_grad(loss_fn)(params)
            delta, opt_state = optimizer.update(grads, opt_state, params)
            params = optax.apply_updates(params, delta)
            finite &= jnp.isfinite(loss) & jnp.all(jnp.stack([
                jnp.all(jnp.isfinite(x)) for x in jax.tree_util.tree_leaves((params, opt_state))]))
            return params, opt_state, loss_sum + loss * mask.sum(), finite
        params, opt_state, loss_sum, finite = jax.lax.fori_loop(
            0, updates, body, (params, opt_state, jnp.float32(0), jnp.array(True)))
        return params, opt_state, key, loss_sum / jnp.maximum(count, 1), updates, finite
    return learn


def save_checkpoint(path, params, opt_state, key, config, stats):
    """Atomic, non-pickle NPZ; save only at fully consumed round boundaries."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    leaves = jax.tree_util.tree_leaves(opt_state)
    payload = {f'param/{k}': np.asarray(v) for k, v in params.items()}
    payload.update({f'opt/{i}': np.asarray(v) for i, v in enumerate(leaves)})
    payload.update(key=np.asarray(key), metadata=np.array(json.dumps(
        dict(format_version=1, config=config, stats=stats, optimizer_leaves=len(leaves)))))
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('wb') as f:
        np.savez(f, **payload)
        f.flush()
        os.fsync(f.fileno())
    temporary.replace(path)


def restore_checkpoint(path):
    with np.load(path, allow_pickle=False) as data:
        meta = json.loads(str(data['metadata']))
        if meta['format_version'] != 1:
            raise ValueError('Unsupported checkpoint format')
        params = {k[6:]: jnp.asarray(data[k]) for k in data.files if k.startswith('param/')}
        template = optimizer_for(meta['config']).init(params)
        leaves, tree = jax.tree_util.tree_flatten(template)
        if len(leaves) != meta['optimizer_leaves']:
            raise ValueError('Optimizer checkpoint structure differs from this Optax version')
        restored = [jnp.asarray(data[f'opt/{i}']) for i in range(len(leaves))]
        for expected, actual in zip(leaves, restored):
            if expected.shape != actual.shape or expected.dtype != actual.dtype:
                raise ValueError('Optimizer checkpoint shape/dtype mismatch')
        return params, jax.tree_util.tree_unflatten(tree, restored), jnp.asarray(data['key']), meta['config'], meta['stats']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', default='models/selfplay_v1.npz')
    parser.add_argument('--out', type=Path, default=Path('checkpoints/jax-selfplay'))
    parser.add_argument('--resume', type=Path, help='Explicit full JAX checkpoint; saved algorithm settings take precedence')
    parser.add_argument('--hours', type=float, default=1.)
    parser.add_argument('--rounds', type=int, help='Also stop after this many rounds in this session')
    parser.add_argument('--num-envs', type=int, default=64)
    parser.add_argument('--capacity', type=int, default=64)
    parser.add_argument('--batch-size', type=int, default=1024)
    parser.add_argument('--learning-rate', type=float, default=3e-4)
    parser.add_argument('--epsilon', type=float, default=.01)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--save-minutes', type=float, default=15.)
    parser.add_argument('--log-seconds', type=float, default=10.)
    parser.add_argument('--allow-cpu', action='store_true')
    args = parser.parse_args()
    if min(args.num_envs, args.capacity, args.batch_size, args.hours, args.learning_rate,
           args.save_minutes, args.log_seconds) <= 0 or (args.rounds is not None and args.rounds <= 0):
        parser.error('Sizes, rates and durations must be positive')
    if not 0 <= args.epsilon <= 1 or args.capacity > env.NUM_ACTIONS:
        parser.error('Invalid epsilon or action capacity')
    if not args.allow_cpu and jax.default_backend() != 'gpu':
        parser.error('GPU required; --allow-cpu is for smoke tests only')
    args.out.mkdir(parents=True, exist_ok=True)
    if (args.out / 'latest.npz').exists() and args.resume is None:
        parser.error('Output contains a checkpoint; use --resume or a new --out directory')
    jax.config.update('jax_default_matmul_precision', 'highest')
    if args.resume:
        params, opt_state, key, config, stats = restore_checkpoint(args.resume)
    else:
        config = dict(num_envs=args.num_envs, capacity=args.capacity, batch_size=args.batch_size,
                      learning_rate=args.learning_rate, epsilon=args.epsilon, grad_clip=1.,
                      seed=args.seed, initial_weights=args.weights,
                      initial_weights_sha256=hashlib.sha256(Path(args.weights).read_bytes()).hexdigest(),
                      precision='highest', jax_version=jax.__version__, optax_version=optax.__version__)
        params = load_weights(args.weights)
        opt_state = optimizer_for(config).init(params)
        key = jax.random.PRNGKey(args.seed)
        stats = dict(games=0, samples=0, updates=0, rounds=0, train_seconds=0.)
    stop_requested = False

    def request_stop(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        print('Stop requested; finishing the current round before saving.', flush=True)
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    print(json.dumps(dict(devices=[str(d) for d in jax.devices()], jax=jax.__version__,
                          optax=optax.__version__, config=config, stats=stats)), flush=True)
    print('Compiling and warming up (discarding warmup updates)...', flush=True)
    compile_start = time.perf_counter()
    collect = make_collect(config['num_envs'], config['capacity'], config['epsilon']).lower(params, key).compile()
    warm = jax.block_until_ready(collect(params, key))
    learn = make_learn(config).lower(params, opt_state, warm[0], *warm[1:5]).compile()
    jax.block_until_ready(learn(params, opt_state, warm[0], *warm[1:5]))
    del warm
    print(f'Compilation and warmup: {time.perf_counter() - compile_start:.2f}s', flush=True)
    start = last_log = last_save = time.perf_counter()
    old_seconds, initial_games, initial_samples = stats['train_seconds'], stats['games'], stats['samples']
    session_rounds = 0
    args.out.joinpath('config.json').write_text(json.dumps(config, indent=2) + '\n')

    def save():
        stats['train_seconds'] = old_seconds + time.perf_counter() - start
        save_checkpoint(args.out / f"model_{stats['games']}.npz", params, opt_state, key, config, stats)
        save_checkpoint(args.out / 'latest.npz', params, opt_state, key, config, stats)
        print(f"Saved {args.out / 'latest.npz'} ({stats['games']:,} games)", flush=True)

    # A failed round never replaces the last known valid checkpoint.
    try:
        while not stop_requested and time.perf_counter() - start < args.hours * 3600:
            if args.rounds is not None and session_rounds >= args.rounds:
                break
            collect_start = time.perf_counter()
            batch = jax.block_until_ready(collect(params, key))
            collect_seconds = time.perf_counter() - collect_start
            metrics = batch[5]
            if int(metrics['games']) != config['num_envs']:
                raise RuntimeError('Episode exceeded the turn bound; refusing truncated Monte Carlo returns')
            learn_start = time.perf_counter()
            result = jax.block_until_ready(learn(params, opt_state, batch[0], *batch[1:5]))
            learn_seconds = time.perf_counter() - learn_start
            if not bool(result[5]):
                raise RuntimeError('Non-finite update; retaining previous checkpoint state')
            params, opt_state, key = result[:3]
            stats['games'] += int(metrics['games'])
            stats['samples'] += int(metrics['decisions'])
            stats['updates'] += int(result[4])
            stats['rounds'] += 1
            session_rounds += 1
            now = time.perf_counter()
            if now - last_log >= args.log_seconds or session_rounds == 1:
                stats['train_seconds'] = old_seconds + now - start
                row = dict(**stats, session_seconds=now-start,
                           games_per_second=(stats['games']-initial_games)/(now-start),
                           samples_per_second=(stats['samples']-initial_samples)/(now-start),
                           loss=float(result[3]), last_round_turns=int(metrics['turns']),
                           collect_seconds=collect_seconds, learn_seconds=learn_seconds,
                           active_lane_fraction=int(metrics['decisions']) / (int(metrics['turns']) * config['num_envs']))
                print(json.dumps(row), flush=True)
                with (args.out / 'train.jsonl').open('a') as f:
                    f.write(json.dumps(row) + '\n')
                last_log = now
            if now - last_save >= args.save_minutes * 60:
                save()
                last_save = time.perf_counter()
    finally:
        save()


if __name__ == '__main__':
    main()
