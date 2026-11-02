"""Repository identity for code reference URIs (``git+<url>@<commit>#<path>``).

See the shared reference forms in OpenAgentTrust's ``docs/integration/shared-references.md``.
Everything here is best effort: outside a git checkout, or without git, there are no refs.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

_SCP_LIKE = re.compile(r"^(?:[\w.-]+@)?([\w.-]+):(?!//)(.+)$")
_CREDENTIALS = re.compile(r"^(\w+://)[^/@]*@")


@dataclass(frozen=True)
class Repository:
    url: str | None
    commit: str
    prefix: str  # path of the analysis root inside the repository, "" at the top level

    def ref(self, path: str) -> str | None:
        """Reference URI for ``path`` (relative to the analysis root), if the repo has a URL."""
        if self.url is None:
            return None
        full = f"{self.prefix}/{path}" if self.prefix else path
        return f"git+{self.url}@{self.commit}#{full}"

    def to_dict(self) -> dict[str, str | None]:
        return {"url": self.url, "commit": self.commit, "path": self.prefix or None}


def normalise_remote(url: str) -> str:
    """HTTPS form without credentials or ``.git``; never leak a token embedded in a remote."""
    url = url.strip()
    scp = _SCP_LIKE.match(url)
    if scp and "://" not in url:
        url = f"https://{scp.group(1)}/{scp.group(2)}"
    url = _CREDENTIALS.sub(r"\1", url)
    if url.startswith(("ssh://", "git://")):
        url = "https://" + url.split("://", 1)[1]
    url = url.removesuffix("/").removesuffix(".git")
    return url


def _git(root: Path, *args: str) -> str | None:
    git = shutil.which("git")
    if git is None:
        return None
    try:
        done = subprocess.run(  # noqa: S603 - fixed git subcommands, no shell
            [git, "-C", str(root), *args],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def repository(root: Path) -> Repository | None:
    commit = _git(root, "rev-parse", "HEAD")
    top = _git(root, "rev-parse", "--show-toplevel")
    if not commit or not top:
        return None
    remote = _git(root, "config", "--get", "remote.origin.url")
    try:
        prefix = root.resolve().relative_to(Path(top).resolve()).as_posix()
    except ValueError:
        prefix = ""
    return Repository(
        url=normalise_remote(remote) if remote else None,
        commit=commit,
        prefix="" if prefix == "." else prefix,
    )
