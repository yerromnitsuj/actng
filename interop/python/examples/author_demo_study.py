# %% [markdown]
# # Authoring a promotion study from a chainladder session
#
# This is the notebook-shaped authoring session behind the workbench's
# committed demo fixture (`apps/server/data/demo/demo-study.json`): a real
# chainladder-python analysis whose selections leave the notebook as an
# actuarial-interchange StudyDoc, ready for the workbench's "Import study"
# panel (spec rev 2.1 sections 3.2 StudyDoc and 4.2 save_study).
#
# Run it from the repo root with the interop venv:
#
#     .venv-interop/bin/python interop/python/examples/author_demo_study.py
#
# The output is DETERMINISTIC: `created_at` is pinned (purity rule — the
# bridges never read a clock) and every integrity tag derives from the
# canonical JSON of the semantic body, so re-running the script reproduces
# the committed fixture byte for byte (given the pinned chainladder version,
# which the study's supporting result honestly records).
#
# Requires the `[chainladder]` extra:  pip install -e "interop/python[chainladder]"

# %%
from pathlib import Path

import chainladder as cl

from actuarial_interchange import save_study
from actuarial_interchange.bridge_result import extract_result
from actuarial_interchange.bridge_selection import extract_selections
from actuarial_interchange.bridge_triangle import cl_to_triangle_doc

#: Pinned so the fixture is reproducible; the workbench treats it as data.
CREATED_AT = "2026-07-18T00:00:00Z"

#: Default output = the committed workbench fixture; pass a path to override.
DEFAULT_OUT = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "server"
    / "data"
    / "demo"
    / "demo-study.json"
)

# %% [markdown]
# ## 1. Load the triangle
#
# GenIns (Taylor & Ashe 1983 via the chainladder samples): ten accident
# years 2001-2010, annual development to 120 months, cumulative paid. One
# `cl.Triangle` slice becomes one TriangleDoc; `measure` is caller-supplied
# because chainladder column names are free-form. The segment labels travel
# with the triangle so the receiving host can resolve a workspace target
# (the workbench is single-segment and accepts any labels).

# %%
triangle = cl.load_sample("genins")
triangle_doc = cl_to_triangle_doc(
    triangle,
    measure="paid",
    created_at=CREATED_AT,
    segment={"labels": {"dataset": "GenIns"}},
)

# %% [markdown]
# ## 2. Fit the development model and extract the selections
#
# A plain volume-weighted all-period Development fit. `extract_selections`
# records both the VALUES and the INTENT (all-period volume-weighted), so
# an exact-capable engine on the other side replays the recipe rather than
# trusting the numbers — the workbench's replay-verify gate labels each
# interval `replayed-exact` for precisely this reason.

# %%
development = cl.Development(average="volume").fit(triangle)
selection_doc = extract_selections(
    development,
    measure="paid",
    triangle_integrity=triangle_doc.integrity(),
    created_at=CREATED_AT,
)

# %% [markdown]
# ## 3. Run the method here and keep the result as evidence
#
# The fitted Chainladder ultimates travel as a supporting MethodResultDoc.
# The workbench's promotion chain crosschecks this engine's numbers against
# its own replay at the study's tolerance — a `disagree` verdict hard-blocks
# the promotion, which is the whole point of carrying the result along.

# %%
ibnr = cl.Chainladder().fit(development.fit_transform(triangle))
result_doc = extract_result(
    ibnr,
    created_at=CREATED_AT,
    triangle_integrity=triangle_doc.integrity(),
    selection_integrity=selection_doc.integrity(),
    parameters={"average": "volume", "n_periods": -1},
    convention_profile="deterministic-cl",
)

# %% [markdown]
# ## 4. Save the study
#
# The narrative is the analyst's own words — it seeds the draft rationale
# the promoting actuary edits at the rationale gate. `replayTolerance` states
# how tightly the author expects a replay to agree; the host referees at
# min(stated, host ceiling), and a study stating more than the host ceiling
# fails intake.

# %%
if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    study = save_study(
        title="GenIns paid development study",
        narrative={
            "analyst": "Notebook analyst",
            "sourceRef": "nb/genins-study.ipynb",
            "summary": (
                "Volume-weighted all-period paid LDFs fitted to the GenIns "
                "triangle; factors are stable across origins with no "
                "exclusions and no tail beyond 120 months."
            ),
        },
        triangles=[triangle_doc],
        selections=[selection_doc],
        supporting_results=[result_doc],
        expectations={"replayTolerance": 1e-6},
        created_at=CREATED_AT,
        path=out,
    )
    print(f"study {study.integrity()} -> {out}")
