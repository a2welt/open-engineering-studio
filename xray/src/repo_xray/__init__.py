"""Repo X-Ray: import graph, architecture layers and change impact for a source tree.

The analysis is static and local: it reads Python and TypeScript sources under one root,
resolves imports between them and never executes project code.
"""

from .analysis import Analysis, analyze
from .canonical import digest
from .change import ChangeError, change_impact
from .config import Config, LayerRule, load_config

__all__ = [
    "Analysis",
    "ChangeError",
    "Config",
    "LayerRule",
    "__version__",
    "analyze",
    "change_impact",
    "digest",
    "load_config",
]

__version__ = "0.1.0"
