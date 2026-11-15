"""Shared pytest setup.

Run JAX on the CPU. With jax-metal installed, JAX defaults to the Apple GPU,
which cannot compile some operations the environment uses (population_count
fails with "mhlo.popcnt" unsupported). Set JAX_PLATFORMS yourself to override.
This runs before any test module imports jax.
"""
import os

os.environ.setdefault("JAX_PLATFORMS", "cpu")
