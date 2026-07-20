#!/usr/bin/env Rscript
# CLI entrypoint: triangle document in, Mack fit, method-result document out.
#
#   Rscript tools/interop/run-mack.R --in <triangle.json> --out <result.json> \
#     --created-at <iso8601> [--selection <selection.json>] [--profile <name>]
#
# --created-at is REQUIRED: the adapter's assemble/extract helpers default it
# to a hardcoded literal, and a document that always claims the same date
# breaks byte-determinism for everyone downstream.
#
# --selection is honored, never merely stamped (Finding #1). The fit is
# computed UNDER the selection, or the stamp is withheld:
#   * factors == the alpha=1 fit's volume-weighted factors -> today's exact
#     path; the stamp is now VERIFIED true and the bytes are unchanged;
#   * a feasible non-VW selection -> CLFMdelta solves a per-period alpha
#     (alpha = 2 - delta), the fit refits at it, and parameters.alpha echoes
#     the per-period vector;
#   * an infeasible selection, or one carrying a tail factor MackChainLadder
#     cannot consume -> the fit runs WITHOUT the selection,
#     appliesTo.selectionIntegrity is null, and warnings say not-comparable;
#   * a selection whose appliesTo.triangleIntegrity does not match --in is a
#     hard error (input-linkage mismatch).
#
# --profile defaults to "deterministic-cl": MackChainLadder(alpha = 1, all
# periods, no tail) IS the volume-weighted all-period chain ladder point
# estimate, so its central results are exactly what that profile compares.
# (The extractor's own default, "mack1993-vw", is for SE-focused runs; an
# injected non-VW fit downgrades it to profile-less rather than overclaiming.)

local({
  lib <- path.expand("~/.R-interop-lib")
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})
.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(fa) == 1L && nzchar(fa)) normalizePath(fa) else normalizePath("tools/interop/run-mack.R")
})
source(file.path(dirname(.this_file), "actuarialInterchange.R"))
suppressPackageStartupMessages(library(ChainLadder))

parse_args <- function(argv) {
  out <- list(`in` = NULL, out = NULL, `created-at` = NULL, selection = NULL, profile = "deterministic-cl")
  i <- 1L
  while (i <= length(argv)) {
    key <- sub("^--", "", argv[[i]])
    if (!key %in% names(out)) stop(sprintf("unknown argument --%s", key))
    if (i + 1L > length(argv)) stop(sprintf("--%s needs a value", key))
    out[[key]] <- argv[[i + 1L]]
    i <- i + 2L
  }
  for (req in c("in", "out", "created-at")) {
    if (is.null(out[[req]])) stop(sprintf("--%s is required", req))
  }
  out
}

args <- parse_args(commandArgs(trailingOnly = TRUE))

tri_doc <- ats_read_document(args$`in`)          # verifies the integrity tag
selection_doc <- if (!is.null(args$selection)) ats_read_document(args$selection) else NULL

m <- ats_triangle_to_matrix(tri_doc)
tri <- as.triangle(m)

# Honor --selection honestly (Finding #1): compute UNDER the selection, or
# refuse to stamp it. `stamp_selection` is what appliesTo.selectionIntegrity
# links to (NULL => null stamp); `alpha` drives the fit.
stamp_selection <- selection_doc
extra_warnings <- character(0)
alpha <- 1
if (!is.null(selection_doc)) {
  sel_tri_tag <- selection_doc$selection$appliesTo$triangleIntegrity
  tri_tag <- if (!is.null(tri_doc$integrity)) tri_doc$integrity else ats_integrity(tri_doc$triangle)
  if (!is.null(sel_tri_tag) && !identical(sel_tri_tag, tri_tag)) {
    stop(sprintf("--selection applies to triangle %s but --in is %s", sel_tri_tag, tri_tag))
  }
  plan <- ats_mack_selection_plan(tri, selection_doc)
  extra_warnings <- plan$warnings
  if (identical(plan$mode, "injected")) alpha <- plan$alpha
  if (identical(plan$mode, "not-injectable")) stamp_selection <- NULL
}

fit <- MackChainLadder(tri, alpha = alpha, est.sigma = "Mack")
# est.sigma is EXPLICIT: R's silent log-linear fallback would make
# effectiveParameters disagree with parameters and confuse the referee.

# mack1993-vw is a volume-weighted-only profile: an injected non-VW fit cannot
# claim it (mirrors the Python sidecar's profile-less downgrade).
profile <- args$profile
if (!is.null(selection_doc) && !identical(alpha, 1) && identical(profile, "mack1993-vw")) {
  extra_warnings <- c(extra_warnings,
    "mack1993-vw requires volume-weighted all-period factors; the injected selection is not, so the result runs profile-less rather than overclaiming")
  profile <- NULL   # engine.conventionProfile is omitted (schema .optional())
}

result_doc <- ats_extract_mack_result(
  fit, tri_doc, stamp_selection,
  convention_profile = profile,
  created_at = args$`created-at`,
  extra_warnings = extra_warnings
)
ats_write_document(result_doc, args$out)         # re-stamps the tag on write
if (length(extra_warnings) > 0L) message(paste("WARNING:", extra_warnings, collapse = "\n"))
cat(sprintf("wrote %s (%s)\n", args$out, if (is.null(profile)) "no profile" else profile))
