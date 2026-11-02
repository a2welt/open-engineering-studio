"""Repo X-Ray: import graph, architecture layers and change impact for a source tree.

The analysis is static and local: it reads Python and TypeScript sources under one root,
resolves imports between them and never executes project code.
"""

from .analysis import Analysis, analyze
from .config import Config, LayerRule, load_config

__all__ = ["Analysis", "Config", "LayerRule", "__version__", "analyze", "load_config"]

__version__ = "0.1.0"
