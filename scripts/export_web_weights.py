"""Export the current model (web/src/lib/model/current.json) for the web app.

Writes web/public/model/<model>.bin (little-endian float32, each layer in
PyTorch row-major order, one after another) and <model>.json (each layer's
name, shape and offset in floats).

Run from the repo root: python3 scripts/export_web_weights.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from big2_ai.models.current import MODEL_NAME, MODEL_PATH, PARENT_MODEL_NAME  # noqa: E402

OUT = Path("web/public/model")
LAYERS = ["state_in.weight", "state_in.bias", "move_in.weight", "fc2.weight", "fc2.bias",
          "fc3.weight", "fc3.bias", "out.weight", "out.bias"]


def main():
    checkpoint = torch.load(MODEL_PATH, map_location="cpu")
    weights = checkpoint["model_state_dict"]
    assert sorted(weights) == sorted(LAYERS), sorted(weights)

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"model": MODEL_NAME, "parent_model": PARENT_MODEL_NAME,
                "games": checkpoint["games"], "layers": []}
    chunks, offset = [], 0
    for name in LAYERS:
        array = weights[name].numpy().astype("<f4")
        manifest["layers"].append({"name": name, "shape": list(array.shape), "offset": offset})
        chunks.append(array.reshape(-1))
        offset += array.size
    data = np.concatenate(chunks)
    (OUT / f"{MODEL_NAME}.bin").write_bytes(data.tobytes())
    (OUT / f"{MODEL_NAME}.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {offset:,} floats ({offset * 4:,} bytes) to {OUT}")


if __name__ == "__main__":
    main()
