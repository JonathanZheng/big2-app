"""AI agents for Big 2."""

from .greedy_bot import select_action_greedy_bot
from .smart_bot import select_action_smart_bot

__all__ = ["select_action_greedy_bot", "select_action_smart_bot"]
