"""Deep Monte Carlo self-play training.

Actor processes play games with all four seats using a recent copy of the
model and send every decision, labelled with that player's final reward, to
the learner. The learner uses each example once, in shuffled chunks, and
publishes new weights to the actors through shared memory.
"""

import queue as queue_lib
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.multiprocessing as mp
import torch.nn.functional as F

from ..env import Big2Game, get_legal_moves
from ..env.selfplay_encoding import encode_state, encode_moves
from ..models.selfplay_network import SelfPlayNetwork

CONFIG = {
    "epsilon": 0.01,
    "learning_rate": 3e-4,
    "batch_size": 1024,
    "chunk_size": 16384,     # examples shuffled together before training
    "grad_clip": 1.0,
    "weight_sync_games": 4,  # actors refresh weights every N games
    "log_seconds": 60,
    "save_minutes": 15,
}


def choose_move(model: SelfPlayNetwork, game: Big2Game, player: int, epsilon: float = 0.0):
    """Return (move, state, encoded move) using batched scoring of all legal moves."""
    legal = get_legal_moves(game, player)
    state = encode_state(game, player)
    encoded = encode_moves(legal)
    if len(legal) == 1:
        idx = 0
    elif random.random() < epsilon:
        idx = random.randrange(len(legal))
    else:
        with torch.no_grad():
            q = model(torch.from_numpy(state).float().unsqueeze(0),
                      torch.from_numpy(encoded).float())
        idx = int(torch.argmax(q))
    return legal[idx], state, encoded[idx]


def play_selfplay_game(model: SelfPlayNetwork, epsilon: float):
    """Play one game; return (states, moves, returns) for every decision."""
    game = Big2Game()
    states, moves, players = [], [], []
    while not game.done:
        player = game.current_player
        move, state, encoded = choose_move(model, game, player, epsilon)
        states.append(state)
        moves.append(encoded)
        players.append(player)
        _, _, _, info = game.step(move)
    rewards = info["all_rewards"]
    returns = np.array([rewards[p] for p in players], dtype=np.float32)
    return np.stack(states), np.stack(moves), returns


def actor_loop(shared_model, out_queue, stop_event, seed: int):
    torch.set_num_threads(1)
    random.seed(seed)
    np.random.seed(seed)
    model = SelfPlayNetwork()
    model.eval()
    games = 0
    while not stop_event.is_set():
        if games % CONFIG["weight_sync_games"] == 0:
            model.load_state_dict(shared_model.state_dict())
        batch = play_selfplay_game(model, CONFIG["epsilon"])
        while not stop_event.is_set():
            try:
                out_queue.put(batch, timeout=1.0)
                break
            except queue_lib.Full:
                continue
        games += 1


def _save(path: Path, model, optimizer, stats: dict):
    torch.save({
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "config": CONFIG,
        **stats,
    }, path)


def train(out_dir: str, num_actors: int, hours: float = None):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)

    model = SelfPlayNetwork()
    optimizer = torch.optim.Adam(model.parameters(), lr=CONFIG["learning_rate"])
    stats = {"games": 0, "samples": 0, "steps": 0, "train_seconds": 0.0}

    latest = out / "latest.pt"
    if latest.exists():
        checkpoint = torch.load(latest, map_location="cpu")
        model.load_state_dict(checkpoint["model_state_dict"])
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        stats = {k: checkpoint[k] for k in stats}
        print(f"Resumed from {latest}: {stats['games']:,} games")

    shared_model = SelfPlayNetwork()
    shared_model.load_state_dict(model.state_dict())
    shared_model.share_memory()

    ctx = mp.get_context("spawn")
    out_queue = ctx.Queue(maxsize=num_actors * 16)
    stop_event = ctx.Event()
    actors = [
        ctx.Process(target=actor_loop, args=(shared_model, out_queue, stop_event, random.randrange(2**31)), daemon=True)
        for _ in range(num_actors)
    ]
    for actor in actors:
        actor.start()

    print(f"Training with {num_actors} actors, saving to {out}")
    start = time.time()
    session_start_stats = dict(stats)
    last_log = last_save = start
    deadline = start + hours * 3600 if hours else None
    chunk, chunk_len, losses = [], 0, []

    try:
        while deadline is None or time.time() < deadline:
            try:
                batch = out_queue.get(timeout=5.0)
            except queue_lib.Empty:
                continue
            chunk.append(batch)
            chunk_len += len(batch[2])
            stats["games"] += 1

            if chunk_len >= CONFIG["chunk_size"]:
                states = torch.from_numpy(np.concatenate([b[0] for b in chunk])).float()
                moves = torch.from_numpy(np.concatenate([b[1] for b in chunk])).float()
                returns = torch.from_numpy(np.concatenate([b[2] for b in chunk]))
                order = torch.randperm(len(returns))
                bs = CONFIG["batch_size"]
                for i in range(0, len(order) - bs + 1, bs):
                    idx = order[i:i + bs]
                    loss = F.mse_loss(model(states[idx], moves[idx]), returns[idx])
                    optimizer.zero_grad()
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(model.parameters(), CONFIG["grad_clip"])
                    optimizer.step()
                    losses.append(loss.item())
                    stats["steps"] += 1
                stats["samples"] += chunk_len
                chunk, chunk_len = [], 0
                with torch.no_grad():
                    for shared, local in zip(shared_model.parameters(), model.parameters()):
                        shared.copy_(local)

            now = time.time()
            if now - last_log >= CONFIG["log_seconds"]:
                elapsed = now - start
                session_games = stats["games"] - session_start_stats["games"]
                loss_text = f"{np.mean(losses):.4f}" if losses else "n/a"
                print(f"[{elapsed / 3600:5.2f}h] games {stats['games']:>10,} | "
                      f"{session_games / elapsed:6.0f} games/s | steps {stats['steps']:>8,} | "
                      f"loss {loss_text}", flush=True)
                losses = []
                last_log = now

            if now - last_save >= CONFIG["save_minutes"] * 60:
                stats["train_seconds"] = session_start_stats["train_seconds"] + (now - start)
                _save(out / f"model_{stats['games']}.pt", model, optimizer, stats)
                _save(latest, model, optimizer, stats)
                print(f"  saved model_{stats['games']}.pt", flush=True)
                last_save = now
    except KeyboardInterrupt:
        print("Stopping...")
    finally:
        stop_event.set()
        stats["train_seconds"] = session_start_stats["train_seconds"] + (time.time() - start)
        _save(out / f"model_{stats['games']}.pt", model, optimizer, stats)
        _save(latest, model, optimizer, stats)
        print(f"Saved model_{stats['games']}.pt ({stats['games']:,} games)")
        for actor in actors:
            actor.join(timeout=5)
            if actor.is_alive():
                actor.terminate()
