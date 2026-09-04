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
# (uses the local library at ~/.R-interop-lib; exact pins are declared in
# tools/interop/r-environment.json).

local({
  lib <- path.expand(Sys.getenv("ACTUARIAL_TS_R_LIBRARY", "~/.R-interop-lib"))
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

  # The literature anchor: the one expectation authored by no engine. R's own
  # Mack run must tie to Mack's published standard error directly, so a shared
  # cross-engine error cannot hide behind mutual agreement with the TS output.
  published <- expectations$published
  se_pub <- NULL
  if (!is.null(published) && !is.null(published$citation)) {
    se_pub <- published$totalStandardErrorPercentOfReserve
  }

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

  # The literature check: R's own Mack SE, as a percentage of its own reserve,
  # against Mack's tabled figure at the source's printing precision.
  published_ok <- TRUE
  if (!is.null(se_pub)) {
    pct <- 100 * as.numeric(res$totals$standardError) / as.numeric(res$totals$unpaid)
    published_ok <- abs(pct - as.numeric(se_pub$value)) <= as.numeric(se_pub$tolerancePercentagePoints)
  }

  central_ok <- max(max_central, tot_central) <= central_tol
  se_ok <- max(max_se, tot_se) <= se_tol
  verdict <- if (central_ok && se_ok && published_ok) "AGREE" else "DISAGREE"

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

diagnostic_fixture <- file.path(FIXTURES, "diagnostics", "generalized-casualty")
for (prefix in c("calendar", "ordered-axis")) {
  diagnostic_definition <- ats_parse_diagnostic_definition(file.path(diagnostic_fixture, paste0(prefix, "-definition.json")))
  diagnostic_cells <- jsonlite::fromJSON(file.path(diagnostic_fixture, paste0(prefix, "-aggregate-cells.json")), simplifyVector = FALSE)
  diagnostic_expected <- jsonlite::fromJSON(file.path(diagnostic_fixture, paste0(prefix, "-expected-output.json")), simplifyVector = FALSE)
  if (!identical(ats_canonical_json(diagnostic_definition), diagnostic_expected$canonicalDefinitionJson)) stop("diagnostic canonical definition bytes differ")
  if (length(diagnostic_definition$formulas) != 6L || length(diagnostic_definition$instances) != 22L) stop("diagnostic conformance fixture must contain six formulas and twenty-two instances")
  replay_cells <- ats_diagnostic_aggregate_cells(diagnostic_definition, diagnostic_cells)
  if (length(replay_cells) != 12L || length(diagnostic_expected$result$emergence) != 12L) stop("diagnostic corpus lost cells")
  for (cell_index in seq_along(replay_cells)) {
    cell <- replay_cells[[cell_index]]
    output <- diagnostic_expected$result$emergence[[cell_index]]
    if (!identical(c(cell$coordinate$sourceGroup, cell$coordinate$origin, cell$coordinate$valuation), c(output$group, output$origin, output$valuation))) stop("diagnostic replay coordinates differ")
    metrics <- output$metrics
    for (instance_id in names(metrics)) {
      actual <- ats_replay_diagnostic_cell(diagnostic_definition, instance_id, cell$values)
      expected <- metrics[[instance_id]]$calculation
    expected_fields <- list(numerator=expected$numerator$value,denominator=expected$denominator$value,value=expected$value)
    for (field in c("numerator", "denominator", "value")) {
      if (is.null(expected_fields[[field]])) {
        if (!is.null(actual[[field]])) stop(sprintf("diagnostic %s %s expected null", instance_id, field))
      } else if (abs(as.numeric(actual[[field]]) - as.numeric(expected_fields[[field]])) > 1e-12) {
        stop(sprintf("diagnostic %s %s replay mismatch", instance_id, field))
      }
    }
    }
  }
  replay_reviews <- ats_replay_diagnostic_reviews(diagnostic_definition, diagnostic_cells)
  if (length(replay_reviews) != length(diagnostic_expected$reviews)) stop("diagnostic rule replay count differs")
  for (index in seq_along(replay_reviews)) {
    if (!identical(ats_canonical_json(replay_reviews[[index]]), ats_canonical_json(diagnostic_expected$reviews[[index]])))
      stop(sprintf("diagnostic rule replay mismatch: %s evaluation %d\nactual: %s\nexpected: %s", prefix, index, ats_canonical_json(replay_reviews[[index]]), ats_canonical_json(diagnostic_expected$reviews[[index]])))
  }
}
if (!identical(ats_sort_utf16(c("\ue000", "\U00010000")), c("\U00010000", "\ue000"))) {
  stop("diagnostic identifier ordering is not ECMAScript UTF-16 order")
}
hostile_definition <- diagnostic_definition
hostile_definition$measures[[1]]$futureBehavior <- TRUE
hostile_rejected <- tryCatch({
  ats_validate_closed_diagnostic_definition(hostile_definition)
  FALSE
}, error = function(error) grepl("unsupported diagnostic behavior", conditionMessage(error), fixed = TRUE))
if (!hostile_rejected) stop("R shore accepted restamped unknown diagnostic behavior")
nested_hostile <- diagnostic_definition
nested_index <- which(vapply(nested_hostile$reviewRules, function(rule) identical(rule$kind, "reconcile"), logical(1)))[[1]]
nested_hostile$reviewRules[[nested_index]]$actual$futureBehavior <- TRUE
nested_rejected <- tryCatch({
  ats_validate_closed_diagnostic_definition(nested_hostile)
  FALSE
}, error = function(error) grepl("unsupported diagnostic behavior", conditionMessage(error), fixed = TRUE))
if (!nested_rejected) stop("R shore accepted nested restamped unknown diagnostic behavior")
cat("diagnostic-definition: identities + 528 metric replays + all declarative rule evaluations AGREE across the R shore.\n")
source("tools/interop/test-diagnostic-boundaries.R")

if (!all_agree) quit(status = 1L, save = "no")
