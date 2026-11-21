"""The model the app ships.

web/src/lib/model/current.json is the one place that names it; the web app
imports the same file, so Python and the browser cannot disagree.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_current = json.loads((ROOT / "web/src/lib/model/current.json").read_text())

MODEL_NAME: str = _current["model"]
PARENT_MODEL_NAME: str = _current["parent"]
MODEL_PATH = ROOT / "models" / f"{MODEL_NAME}.pt"
