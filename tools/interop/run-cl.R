#!/usr/bin/env Rscript
# Chain-ladder projection from SUPPLIED per-column LDFs (+ tail): the honest
# way for R to serve an app whose user picks arbitrary factors —
# MackChainLadder always derives its own and cannot accept these.
#
#   Rscript tools/interop/run-cl.R --in <triangle.json> --ldfs 1.5,1.2,... \
#     --tail 1.0 --out <result.json> --created-at <iso8601>
#
# --created-at is REQUIRED, same reason as run-mack.R: the adapter's assemble
# helper defaults it to a hardcoded literal, and a document that always
# claims the same date breaks byte-determinism for everyone downstream.
# --tail defaults to 1 (no tail beyond the triangle's last observed age).

local({
  lib <- path.expand("~/.R-interop-lib")
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})
.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(fa) == 1L && nzchar(fa)) normalizePath(fa) else normalizePath("tools/interop/run-cl.R")
})
source(file.path(dirname(.this_file), "actuarialInterchange.R"))

parse_args <- function(argv) {
  out <- list(`in` = NULL, ldfs = NULL, tail = "1", out = NULL, `created-at` = NULL)
  i <- 1L
  while (i <= length(argv)) {
    key <- sub("^--", "", argv[[i]])
    if (!key %in% names(out)) stop(sprintf("unknown argument --%s", key))
    if (i + 1L > length(argv)) stop(sprintf("--%s needs a value", key))
    out[[key]] <- argv[[i + 1L]]
    i <- i + 2L
  }
  for (req in c("in", "ldfs", "out", "created-at")) {
    if (is.null(out[[req]])) stop(sprintf("--%s is required", req))
  }
  out
}

args <- parse_args(commandArgs(trailingOnly = TRUE))

tri_doc <- ats_read_document(args$`in`)          # verifies the integrity tag
m <- ats_triangle_to_matrix(tri_doc)
nc <- ncol(m)

ldf_tokens <- strsplit(args$ldfs, ",", fixed = TRUE)[[1]]
ldfs <- suppressWarnings(as.numeric(ldf_tokens))
if (length(ldfs) != nc - 1L) {
  stop(sprintf(
    "--ldfs needs %d comma-separated values (one per development interval), got %d",
    nc - 1L, length(ldfs)
  ))
}
# A development factor that is NA (failed coercion), non-finite, or <= 0 can
# only produce silently-wrong numbers — a well-formed, integrity-stamped
# document whose ultimates are garbage. Fail loud instead, naming positions.
bad <- which(!is.finite(ldfs) | ldfs <= 0)
if (length(bad) > 0L) {
  stop(sprintf(
    "--ldfs position(s) %s (%s) are not finite positive numbers",
    paste(bad, collapse = ", "),
    paste(ldf_tokens[bad], collapse = ", ")
  ))
}
tail <- suppressWarnings(as.numeric(args$tail))
if (length(tail) != 1L || !is.finite(tail) || tail <= 0) {
  stop(sprintf("--tail must be a finite positive number, got '%s'", args$tail))
}

origins <- rownames(m)
rows <- vector("list", nrow(m))
tot_ultimate <- 0
tot_unpaid <- 0
for (i in seq_len(nrow(m))) {
  observed <- which(!is.na(m[i, ]))
  if (length(observed) == 0L) stop(sprintf("origin %s has no observed values", origins[i]))
  col <- max(observed) # last non-NA column for this origin (1-based)
  latest <- as.numeric(m[i, col])
  # R's `:` counts DOWN when the left bound exceeds the right (10:9 == c(10,
  # 9), not empty), so a fully-developed origin (col == nc, one past the
  # last LDF index) must short-circuit to the empty product (== 1) rather
  # than fall through into that trap.
  beyond <- if (col <= nc - 1L) prod(ldfs[col:(nc - 1L)]) else 1
  ultimate <- latest * beyond * tail
  unpaid <- ultimate - latest
  rows[[i]] <- list(origin = origins[i], latest = latest, ultimate = ultimate, unpaid = unpaid)
  tot_ultimate <- tot_ultimate + ultimate
  tot_unpaid <- tot_unpaid + unpaid
}

body <- list(
  appliesTo = list(triangleIntegrity = tri_doc$integrity, selectionIntegrity = NULL),
  engine = list(name = "R ldf projection", version = as.character(getRversion())),
  method = "r:ldf-projection",
  parameters = list(ldfs = as.list(ldfs), tail = tail),
  rows = rows,
  totals = list(ultimate = tot_ultimate, unpaid = tot_unpaid)
)

result_doc <- ats_assemble_document("method-result", body, created_at = args$`created-at`)
ats_write_document(result_doc, args$out) # re-stamps the tag on write
cat(sprintf("wrote %s\n", args$out))
