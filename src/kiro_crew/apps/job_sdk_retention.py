"""Run-record retention: the per-kind count cap and the sweep that applies it.

A kind registered with ``retention`` keeps its newest terminal records and evicts
the rest after each terminal write (app-kit-platform §26.1). ``JobSDK`` binds
``sweep_retention`` as its own member; ``JobStore``'s sweep scan reads each record
with ``_read_record_nolink``.

Served through :mod:`kiro_crew.apps.job_sdk`, which callers and tests import and patch;
this module never imports it.
"""

from __future__ import annotations

import logging
import os
import stat
from pathlib import Path
from typing import Any

from kiro_crew import platform_compat

#: The Job SDK logs under its facade's name, so one logger covers the whole family.
logger = logging.getLogger("kiro_crew.apps.job_sdk")

#: No cap: a kind registered without ``retention`` keeps every record, so an app
#: that never opts in loses nothing on an upgrade.
_NO_RETENTION = 0


def sweep_retention(self: Any, runner: Any, finished: Any) -> None:
    """Evict the oldest terminal records of ``finished.kind`` past its cap.

    Runs on the terminal thread after ``finished``'s record is written, so it never
    raises: a failure is logged and the run's own terminal state stands. Either way
    ``finished`` leaves ``_unswept``, so a later sweep may weigh it.
    """
    try:
        _sweep(self, runner, finished)
    except Exception:  # noqa: BLE001 - a sweep failure must not escape the terminal finally
        logger.exception("App %s retention sweep for kind %s failed", self._app_name, finished.kind)
    finally:
        with self._lock:
            self._unswept.discard(finished.run_id)


def _sweep(self: Any, runner: Any, finished: Any) -> None:
    """Remove the oldest terminal records of the kind so at most ``cap`` remain.

    A run still executing, or one that finished but whose own sweep has not run yet
    (``finished`` among them), is held: never removed, and each held terminal
    record takes one of the ``cap`` places. The rest are ranked by their stamps.
    Holding ``finished`` instead of ranking it matters because the stamps are whole
    seconds: a sort alone could rank it below an older run that ties, and evict it.
    When runs finish at once, which of them the cap keeps depends on the order
    their sweeps run in; once every sweep has run, at most ``cap`` remain.
    """
    cap = runner.retention
    if cap <= _NO_RETENTION:
        return
    # One sweep at a time per SDK, so a sweep sees the store the previous one
    # pruned. Lock order is ``_sweep_lock`` then ``self._lock``, and nothing
    # holding ``self._lock`` takes ``_sweep_lock``.
    with self._sweep_lock:
        terminal = [
            r for r in self._store._iter_runs_nolink() if r.kind == finished.kind and r.is_terminal
        ]
        # Read AFTER the scan: a run the scan saw as terminal is live until its
        # live-table pop and unswept from then until its own sweep ends, which
        # cannot happen while this sweep holds ``_sweep_lock``. Read before, a run
        # finishing during the scan would be ranked and could be removed.
        with self._lock:
            held = set(self._live) | self._unswept
        rankable = [r for r in terminal if r.run_id not in held]
        keep = max(cap - (len(terminal) - len(rankable)), 0)
        excess = len(rankable) - keep
        if excess <= 0:
            return
        rankable.sort(key=_age_key)
        for r in rankable[:excess]:
            # Under the lock disable sets ``_closed`` with: a worker that outlives
            # disable must not delete records a re-enabled SDK now owns.
            with self._lock:
                if self._closed:
                    return
                removed = self._store.remove(r.run_id)
            if removed:
                self._audit("job_evicted", r.run_id, "ok")


def _age_key(r: Any) -> tuple[str, str, str]:
    """Oldest first, by when the run finished. The stamps sort as text."""
    return (r.finished_at, r.updated_at, r.created_at)


def _read_record_nolink(path: Path, limit: int) -> bytes | None:
    """A record file's bytes, or None for a link, a non-regular file, or over ``limit``.

    ``open_file_no_reparse`` refuses a link at the name in the same operation that
    opens it, on Windows too, and ``nonblocking`` keeps a planted FIFO from waiting
    for a writer before ``fstat`` rejects it. An OS error is None as well.
    """
    try:
        fd = platform_compat.open_file_no_reparse(path, nonblocking=True)
    except OSError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        with os.fdopen(fd, "rb") as fh:
            fd = -1
            data = fh.read(limit + 1)
    except OSError:
        return None
    finally:
        if fd >= 0:
            os.close(fd)
    return data if len(data) <= limit else None
