"""Network for the self-play model: scores (state, move) pairs."""

import torch
import torch.nn as nn
import torch.nn.functional as F

from ..env.selfplay_encoding import STATE_DIM, MOVE_DIM


class SelfPlayNetwork(nn.Module):
    """
    MLP on state + move, with the first layer split so the state part is
    computed once per decision and shared by every legal move.

        h1 = relu(W_s state + W_m move + b)  -> 512
        512 -> 512 -> 256 -> 1 (expected reward)
    """

    def __init__(self, state_dim: int = STATE_DIM, move_dim: int = MOVE_DIM):
        super().__init__()
        self.state_in = nn.Linear(state_dim, 512)
        self.move_in = nn.Linear(move_dim, 512, bias=False)
        self.fc2 = nn.Linear(512, 512)
        self.fc3 = nn.Linear(512, 256)
        self.out = nn.Linear(256, 1)

    def forward(self, states: torch.Tensor, moves: torch.Tensor) -> torch.Tensor:
        """states (n, state_dim) or (1, state_dim), moves (n, move_dim) -> (n,)"""
        x = F.relu(self.state_in(states) + self.move_in(moves))
        x = F.relu(self.fc2(x))
        x = F.relu(self.fc3(x))
        return self.out(x).squeeze(-1)


if __name__ == "__main__":
    net = SelfPlayNetwork()
    print(f"Parameters: {sum(p.numel() for p in net.parameters()):,}")
    q = net(torch.zeros(1, STATE_DIM), torch.zeros(7, MOVE_DIM))
    assert q.shape == (7,)
    print("Test complete!")
