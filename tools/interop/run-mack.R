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
# --profile defaults to "deterministic-cl": MackChainLadder(alpha = 1, all
# periods, no tail) IS the volume-weighted all-period chain ladder point
# estimate, so its central results are exactly what that profile compares.
# (The extractor's own default, "mack1993-vw", is for SE-focused runs.)

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
fit <- MackChainLadder(as.triangle(m), alpha = 1, est.sigma = "Mack")
# est.sigma is EXPLICIT: R's silent log-linear fallback would make
# effectiveParameters disagree with parameters and confuse the referee.

result_doc <- ats_extract_mack_result(
  fit, tri_doc, selection_doc,
  convention_profile = args$profile,
  created_at = args$`created-at`
)
ats_write_document(result_doc, args$out)         # re-stamps the tag on write
cat(sprintf("wrote %s (%s)\n", args$out, args$profile))
