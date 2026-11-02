"""Export weights and independent PyTorch score fixtures; run locally with torch."""
from pathlib import Path
import random
import numpy as np
import torch
from big2_ai.models.selfplay_network import SelfPlayNetwork
from big2_ai.env.game import Big2Game
from big2_ai.env.move_generator import get_legal_moves
from big2_ai.env.selfplay_encoding import encode_state, encode_moves


def main():
    torch.set_num_threads(1)
    checkpoint = torch.load('models/selfplay_v1.pt', map_location='cpu', weights_only=True)
    model = SelfPlayNetwork().eval()
    model.load_state_dict(checkpoint['model_state_dict'])
    np.savez('models/selfplay_v1.npz', **{k: v.numpy() for k, v in model.state_dict().items()})
    random.seed(42)
    game = Big2Game()
    states, moves = [], []
    for _ in range(128):
        if game.done:
            game.reset()
        legal = get_legal_moves(game, game.current_player)
        observation = encode_state(game, game.current_player)
        states.extend([observation] * len(legal))
        moves.extend(encode_moves(legal))
        game.step(random.choice(legal))
    states, moves = np.array(states, np.float32), np.array(moves, np.float32)
    with torch.no_grad():
        expected = model(torch.from_numpy(states), torch.from_numpy(moves)).numpy()
    Path('experiments/jax_big2/fixtures').mkdir(exist_ok=True)
    np.savez_compressed('experiments/jax_big2/fixtures/torch_scores.npz', states=states, moves=moves, scores=expected)
    print(f'Exported best weights and {len(expected)} PyTorch score fixtures')


if __name__ == '__main__':
    main()
