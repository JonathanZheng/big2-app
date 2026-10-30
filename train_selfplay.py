"""Train the Big 2 model with Deep Monte Carlo self-play.

Runs until stopped (Ctrl+C) or for --hours, and resumes from
<out>/latest.pt when it exists.
"""

import argparse

from big2_ai.training.selfplay import train


def main():
    parser = argparse.ArgumentParser(description="Self-play training for Big 2")
    parser.add_argument("--out", default="checkpoints/selfplay", help="Checkpoint directory")
    parser.add_argument("--actors", type=int, default=6, help="Number of actor processes")
    parser.add_argument("--hours", type=float, default=None, help="Stop after this many hours")
    args = parser.parse_args()
    train(args.out, args.actors, args.hours)


if __name__ == "__main__":
    main()
