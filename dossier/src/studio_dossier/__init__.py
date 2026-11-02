"""Change dossiers: one change's evidence, as references to the tools that hold it."""

from .build import DOSSIER_TYPE, DossierError, Sources, build_dossier, verify_dossier

__all__ = [
    "DOSSIER_TYPE",
    "DossierError",
    "Sources",
    "__version__",
    "build_dossier",
    "verify_dossier",
]

__version__ = "0.1.0"
