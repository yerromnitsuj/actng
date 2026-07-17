"""Bundle/study workflow (spec 4.2): ``load_bundle`` and ``save_study``.

``load_bundle`` reads a wrapped reproducibility bundle (spec 3.2
BundleDoc) and returns everything a Python consumer needs WITHOUT ever
parsing the TS-native inner blob: the mirror triangles (as
``cl.Triangle`` via the existing bridge), the selections, and the results
flattened to pandas DataFrames. Integrity contract, in checking order:

1. the OUTER tag over the raw ``{ bundle, interchange }`` body is
   verified first (``BadInterchangeError`` naming both tags on mismatch —
   any tamper of the mirror or the inner segment fails here);
2. each embedded mirror document's OWN tag is verified as it is parsed
   (so a mirror whose outer tag was recomputed after tampering still
   fails on the stale embedded tag).

Both checks live in ``parse_document`` (kind "bundle"); this module adds
the consumer-shaped view on top.

The ``chainladder=`` gate: the module imports are stdlib-only, and with
``chainladder=False`` the whole call stays that way — triangles come back
as their embedded Documents and the DataFrames are ``None`` (pandas
arrives with the ``[chainladder]`` extra, so the frames are gated with
the conversion). ``chainladder=True`` (the default) requires the extra.

``save_study`` authors the promotion unit (spec 3.2 StudyDoc) from
already-bridged documents and refuses an empty narrative summary
(spec 4.2). It takes Documents, not fitted estimators — bridging is the
``bridge_*`` modules' job — so it is stdlib-only too.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence, Union

from .documents import (
    BundlePayload,
    Document,
    MethodResultPayload,
    StudyPayload,
    parse_document,
    serialize_document,
)
from .errors import BadInterchangeError

__all__ = ["LoadedBundle", "load_bundle", "save_study"]


@dataclass
class LoadedBundle:
    """A verified wrapped bundle, shaped for consumption (spec 4.2).

    ``triangles`` and ``triangle_docs`` are keyed by each triangle
    document's INTEGRITY TAG — deliberately not by measure: the tag is
    unique by construction and it is exactly what ``selections[*]
    .payload.applies_to.triangle_integrity`` and ``results[*]
    .payload.applies_to.triangle_integrity`` reference, so linkage is a
    dict lookup. (Measure would collide for multi-segment bundles.)
    """

    #: The parsed BundleDoc (outer tag + every embedded tag verified).
    document: Document
    #: integrity tag -> ``cl.Triangle`` (``chainladder=True``) or the
    #: embedded triangle Document (``chainladder=False``).
    triangles: "dict[str, Any]"
    #: integrity tag -> embedded triangle Document, always available.
    triangle_docs: "dict[str, Document]"
    #: The mirror's SelectionDocs, in committed order.
    selections: "list[Document]"
    #: The mirror's result documents (method/stochastic), in committed order.
    results: "list[Document]"
    #: One row per (result, origin): result/kind/method/engine + the row's
    #: own fields (ultimate/unpaid[/standardError] for method results, the
    #: byOrigin entry for stochastic ones). ``None`` when ``chainladder=False``.
    rows_frame: Any
    #: One row per result: result/kind/method/engine + totals (method) or
    #: nSims + summary (stochastic). ``None`` when ``chainladder=False``.
    totals_frame: Any
    #: The opaque host segment, byte-faithful — for compliance-authored
    #: bundles this is ``{"payload": str, "hash": str}``. Never parsed here.
    inner: dict


def _result_frames(results: "list[Document]") -> "tuple[Any, Any]":
    """Flatten result documents to (rows, totals) DataFrames. A method
    result contributes its rows/totals; a stochastic result contributes
    its byOrigin entries and nSims + summary. ``standardError`` stays
    absent (NaN) where the engine produced none — never zeroed."""
    import pandas as pd

    rows: list[dict] = []
    totals: list[dict] = []
    for doc in results:
        payload = doc.payload
        base = {
            "result": doc.integrity(),
            "kind": doc.kind,
            "method": payload.method,
            "engine": payload.engine.name,
        }
        if isinstance(payload, MethodResultPayload):
            for row in payload.rows:
                rows.append({**base, **row.to_dict()})
            totals.append({**base, **payload.totals.to_dict()})
        else:  # StochasticResultPayload — distribution-level only (spec 3.2)
            for entry in payload.by_origin:
                rows.append({**base, **entry})
            totals.append({**base, "nSims": payload.n_sims, **payload.summary})
    return pd.DataFrame(rows), pd.DataFrame(totals)


def load_bundle(
    source: Union[str, Path, dict], *, chainladder: bool = True
) -> LoadedBundle:
    """Load and verify a wrapped bundle (spec 4.2 contract).

    ``source`` is a filesystem path (``str``/``Path``) or an
    already-loaded JSON dict. The outer tag is verified on load, then each
    embedded mirror document's own tag (see the module docstring for the
    order); any mismatch raises ``BadInterchangeError`` naming both tags.

    With ``chainladder=True`` (default, requires the ``[chainladder]``
    extra) the mirror triangles become ``cl.Triangle`` via the null-
    preserving bridge and the results are flattened to DataFrames. With
    ``chainladder=False`` the call is stdlib-only: ``triangles`` maps tags
    to the embedded Documents and both frames are ``None``.
    """
    if isinstance(source, (str, Path)):
        raw = json.loads(Path(source).read_text())
    else:
        raw = source

    document = parse_document(raw)
    if not isinstance(document.payload, BundlePayload):
        raise BadInterchangeError(
            f"expected a bundle document, got kind '{document.kind}'"
        )
    payload = document.payload

    triangle_docs = {doc.integrity(): doc for doc in payload.triangles}

    if chainladder:
        from .bridge_triangle import triangle_doc_to_cl

        triangles: "dict[str, Any]" = {
            tag: triangle_doc_to_cl(doc) for tag, doc in triangle_docs.items()
        }
        rows_frame, totals_frame = _result_frames(payload.results)
    else:
        triangles = dict(triangle_docs)
        rows_frame = totals_frame = None

    return LoadedBundle(
        document=document,
        triangles=triangles,
        triangle_docs=triangle_docs,
        selections=list(payload.selections),
        results=list(payload.results),
        rows_frame=rows_frame,
        totals_frame=totals_frame,
        inner=payload.bundle,
    )


_STUDY_RESULT_KINDS = frozenset({"method-result", "stochastic-result"})


def _require_kinds(
    docs: "Sequence[Document]", allowed: "frozenset[str]", slot: str
) -> "list[Document]":
    for doc in docs:
        if doc.kind not in allowed:
            raise BadInterchangeError(
                f"save_study: {slot} carries kind '{doc.kind}'; "
                f"expected one of {sorted(allowed)}"
            )
    return list(docs)


def save_study(
    *,
    title: str,
    narrative: dict,
    triangles: "Sequence[Document]",
    selections: "Sequence[Document]",
    created_at: str,
    supporting_results: "Optional[Sequence[Document]]" = None,
    expectations: Optional[dict] = None,
    path: "Optional[Union[str, Path]]" = None,
) -> Document:
    """Author a StudyDoc (spec 3.2, the promotion unit) from bridged
    documents. Refuses an empty (or missing, or whitespace-only)
    ``narrative["summary"]`` — spec 4.2 — because a study with nothing to
    say is not a promotion candidate. ``created_at`` is caller-supplied
    (purity rule: no clock reads). When ``path`` is given the canonical
    JSON is also written there; the Document is returned either way.
    """
    summary = narrative.get("summary") if isinstance(narrative, dict) else None
    if not isinstance(summary, str) or not summary.strip():
        raise BadInterchangeError(
            "save_study refuses an empty narrative summary (spec 4.2): "
            "narrative['summary'] must be a non-blank string"
        )

    payload = StudyPayload(
        title=title,
        narrative=narrative,
        triangles=_require_kinds(triangles, frozenset({"triangle"}), "triangles"),
        selections=_require_kinds(selections, frozenset({"selection"}), "selections"),
        supporting_results=(
            None
            if supporting_results is None
            else _require_kinds(supporting_results, _STUDY_RESULT_KINDS, "supportingResults")
        ),
        expectations=expectations,
    )
    document = Document(kind="study", payload=payload, created_at=created_at)
    if path is not None:
        Path(path).write_text(serialize_document(document))
    return document
