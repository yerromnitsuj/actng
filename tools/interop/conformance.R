# conformance.R — R shore of the cross-engine conformance suite (Phase E, E2).
#
# For each committed fixture (taylor-ashe, raa, mortgage): read the committed
# triangle.json, run MackChainLadder(alpha=1, est.sigma="Mack") — the
# mack1993-vw profile (spec 5: its DEFAULT log-linear does NOT match; the
# alpha/delta trap means alpha=1 is volume-weighted, NOT a delta) — extract
# the MethodResultDoc, and compare against the committed mack1993-vw.json /
# expectations.json at the profile tolerances (central 1e-6 relative, SE 0.5%
# relative). Prints a verdict table.
#
# Run:  Rscript tools/interop/conformance.R
# (uses the local library at ~/.R-interop-lib; ChainLadder 0.2.21 + jsonlite).

local({
  lib <- path.expand("~/.R-interop-lib")
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})

# Locate and source the adapter relative to this script.
.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(fa) == 1L && nzchar(fa)) normalizePath(fa) else normalizePath("tools/interop/conformance.R")
})
source(file.path(dirname(.this_file), "actuarialInterchange.R"))

REPO <- ats_repo_root()
FIXTURES <- file.path(REPO, "interop", "conformance", "fixtures")
FIXTURE_NAMES <- c("taylor-ashe", "raa", "mortgage")

reldev <- function(a, b) {
  a <- as.numeric(a)
  b <- as.numeric(b)
  s <- max(abs(a), abs(b))
  if (s == 0) 0 else abs(a - b) / s
}

result_field <- function(node, key) {
  # standardError may be an explicit JSON null -> NULL in the parsed list.
  v <- node[[key]]
  if (is.null(v)) NA_real_ else as.numeric(v)
}

compare_fixture <- function(name) {
  tri_doc <- ats_read_document(file.path(FIXTURES, name, "triangle.json"))
  committed <- ats_read_document(file.path(FIXTURES, name, "mack1993-vw.json"))$result
  expectations <- fromJSON(file.path(FIXTURES, name, "expectations.json"), simplifyVector = FALSE)
  tol <- expectations$`mack1993-vw`$tolerance
  central_tol <- as.numeric(tol$central)
  se_tol <- as.numeric(tol$standardError)

  m <- ats_triangle_to_matrix(tri_doc)
  tri <- as.triangle(m)
  fit <- MackChainLadder(tri, alpha = 1, est.sigma = "Mack")
  res <- ats_extract_mack_result(fit, tri_doc, NULL)$result

  # Index committed + R rows by origin label.
  r_rows <- res$rows
  names(r_rows) <- vapply(r_rows, function(x) x$origin, character(1))
  c_rows <- committed$rows
  names(c_rows) <- vapply(c_rows, function(x) x$origin, character(1))
  origins <- names(c_rows)

  max_central <- 0
  max_se <- 0
  for (o in origins) {
    rr <- r_rows[[o]]
    cc <- c_rows[[o]]
    max_central <- max(max_central, reldev(rr$ultimate, cc$ultimate), reldev(rr$unpaid, cc$unpaid))
    se_r <- result_field(rr, "standardError")
    se_c <- result_field(cc, "standardError")
    if (!is.na(se_r) && !is.na(se_c)) {
      max_se <- max(max_se, reldev(se_r, se_c))
    } else if (xor(is.na(se_r), is.na(se_c)) && !(isTRUE(se_r == 0) || isTRUE(se_c == 0))) {
      max_se <- Inf # one side reported an SE the other omitted (non-zero) -> fail
    }
  }

  tot_central <- max(
    reldev(res$totals$ultimate, committed$totals$ultimate),
    reldev(res$totals$unpaid, committed$totals$unpaid)
  )
  tot_se <- reldev(res$totals$standardError, committed$totals$standardError)

  central_ok <- max(max_central, tot_central) <= central_tol
  se_ok <- max(max_se, tot_se) <= se_tol
  verdict <- if (central_ok && se_ok) "AGREE" else "DISAGREE"

  # Informational: would the DEFAULT log-linear method auto-fall-back to Mack
  # on this fixture? (Records the spec-5 est.sigma honesty finding.)
  effective_from_loglinear <- ats_detect_effective_est_sigma(tri, 1, "log-linear")
  fallback <- if (identical(effective_from_loglinear, "Mack")) "fires" else "no"

  list(
    name = name,
    origins = length(origins),
    max_central = max(max_central, tot_central),
    total_se_reldev = tot_se,
    max_se = max(max_se, tot_se),
    central_tol = central_tol,
    se_tol = se_tol,
    effective_est_sigma = res$effectiveParameters$est.sigma,
    loglinear_fallback = fallback,
    verdict = verdict
  )
}

fmt_e <- function(x) if (is.infinite(x)) "  inf   " else formatC(x, format = "e", digits = 2)

cat("actuarial-interchange R conformance — profile mack1993-vw (alpha=1, est.sigma=\"Mack\")\n")
cat("engine: R ChainLadder ", as.character(utils::packageVersion("ChainLadder")),
  " | jsonlite ", as.character(utils::packageVersion("jsonlite")), "\n", sep = "")
cat(strrep("-", 96), "\n")
cat(sprintf(
  "%-12s %4s  %-11s %-11s %-11s %-9s %-8s %-9s\n",
  "fixture", "orig", "central dev", "SE dev(max)", "total-SE dev", "eff.sigma", "LL->fb", "verdict"
))
cat(strrep("-", 96), "\n")

results <- lapply(FIXTURE_NAMES, compare_fixture)
all_agree <- TRUE
for (r in results) {
  if (r$verdict != "AGREE") all_agree <- FALSE
  cat(sprintf(
    "%-12s %4d  %-11s %-11s %-11s %-9s %-8s %-9s\n",
    r$name, r$origins, fmt_e(r$max_central), fmt_e(r$max_se), fmt_e(r$total_se_reldev),
    r$effective_est_sigma, r$loglinear_fallback, r$verdict
  ))
}
cat(strrep("-", 96), "\n")
cat(sprintf(
  "tolerances: central <= %s, SE <= %s (relative)\n",
  formatC(results[[1]]$central_tol, format = "e", digits = 0),
  formatC(results[[1]]$se_tol, format = "e", digits = 1)
))
cat("LL->fb = would DEFAULT est.sigma=\"log-linear\" auto-fall-back to Mack on this fixture\n")
cat(strrep("=", 96), "\n")
cat(if (all_agree) {
  "OVERALL: AGREE — R ChainLadder reproduces every mack1993-vw fixture within profile tolerances.\n"
} else {
  "OVERALL: DISAGREE — at least one fixture exceeded profile tolerance (see table).\n"
})

if (!all_agree) quit(status = 1L, save = "no")
