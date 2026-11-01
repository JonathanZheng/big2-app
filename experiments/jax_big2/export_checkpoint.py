"""Convert a JAX training checkpoint into a weights-only PyTorch evaluation file."""
import argparse
import json
from pathlib import Path
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    import torch
    from big2_ai.models.selfplay_network import SelfPlayNetwork
    with np.load(args.checkpoint, allow_pickle=False) as data:
        meta = json.loads(str(data['metadata']))
        weights = {k[6:]: torch.from_numpy(data[k].copy()) for k in data.files if k.startswith('param/')}
    model = SelfPlayNetwork()
    model.load_state_dict(weights, strict=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(dict(model_state_dict=model.state_dict(), games=meta['stats']['games'],
                    config=meta['config'], source='jax-selfplay', weights_only=True), args.output)
    print(f'Exported {args.output}; use the NPZ, not this file, to resume JAX training.')


if __name__ == '__main__':
    main()
