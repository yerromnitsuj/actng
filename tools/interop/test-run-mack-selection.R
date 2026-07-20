# test-run-mack-selection.R — guards run-mack.R's --selection honesty
# (Finding #1). run-mack.R must COMPUTE under the supplied selection, not just
# stamp appliesTo.selectionIntegrity for a selection the fit never consumed.
# Three honest outcomes, exercised end-to-end through the CLI:
#
#   vw-match       the selection IS the alpha=1 fit's volume-weighted factors
#                  -> reuse today's exact path; the stamp is now VERIFIED true
#                  and committed pipelines stay byte-identical.
#   injected       CLFMdelta solved a per-period delta -> refit at
#                  alpha = 2 - delta; the stamp is true and the per-period
#                  alpha vector is echoed in parameters.alpha.
#   not-injectable the fit runs WITHOUT the selection (infeasible CLFMdelta, or
#                  a tail factor MackChainLadder cannot consume) -> the stamp
#                  is null and warnings say the rows are not-comparable.
#
# Plus a hard stop() when a selection's appliesTo.triangleIntegrity does not
# match the input triangle (an input-linkage error, run-cl.R's fail-loud style).
#
# Self-contained: sources the adapter, builds perturbed selection docs in
# tempdir() (re-stamping integrity via ats_write_document), drives the real CLI
# with system2, and fails via stopifnot (exit != 0) so CI catches a regression.
#
# Run: Rscript tools/interop/test-run-mack-selection.R

local({
  lib <- path.expand("~/.R-interop-lib")
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})

.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(fa) == 1L && nzchar(fa)) normalizePath(fa) else normalizePath("tools/interop/test-run-mack-selection.R")
})
INTEROP <- dirname(.this_file)
REPO <- dirname(dirname(INTEROP))
source(file.path(INTEROP, "actuarialInterchange.R"))
suppressPackageStartupMessages(library(ChainLadder))

RSCRIPT <- file.path(R.home("bin"), "Rscript")
RUN_MACK <- file.path(INTEROP, "run-mack.R")
FIXDIR <- file.path(REPO, "interop", "conformance", "fixtures", "taylor-ashe")
TRI <- file.path(FIXDIR, "triangle.json")
SEL <- file.path(FIXDIR, "selection.json")
CREATED <- "2026-07-19T00:00:00Z"
stopifnot(file.exists(TRI), file.exists(SEL), file.exists(RUN_MACK))

# --- fixtures + expected values, computed in-test from the same engine -------
tri_doc <- ats_read_document(TRI)
sel_doc <- ats_read_document(SEL)
m <- ats_triangle_to_matrix(tri_doc)
tri <- as.triangle(m)
committed_body <- sel_doc$selection

# The exact volume-weighted (alpha = 1) age-to-age factors, one per dev step.
f_vw <- as.numeric(MackChainLadder(tri, alpha = 1, est.sigma = "Mack")$f)[seq_len(ncol(tri) - 1L)]
# The step-1 SIMPLE average factor (alpha = 0): a deliberate non-VW judgment.
sa_step1 <- mean(m[1:9, 2] / m[1:9, 1])
# What an injected refit at alpha = c(0, 1, ..., 1) must reproduce.
expected_inj_unpaid <-
  sum(summary(MackChainLadder(tri, alpha = c(0, rep(1, 8)), est.sigma = "Mack"))$ByOrigin[["IBNR"]])

# --- helpers -----------------------------------------------------------------
run_cli <- function(...) {
  argv <- c(RUN_MACK, ...)
  out <- suppressWarnings(system2(RSCRIPT, argv, stdout = TRUE, stderr = TRUE))
  st <- attr(out, "status")
  list(status = if (is.null(st)) 0L else st, output = paste(out, collapse = "\n"))
}

dev_order <- function(body) order(vapply(body$development, function(d) as.numeric(d$fromAgeMonths), numeric(1)))

# Write a perturbed selection body to a tempfile; ats_write_document re-stamps
# integrity from the body, so the CLI reads a self-consistent document.
write_sel <- function(body) {
  p <- tempfile(fileext = ".json")
  ats_write_document(ats_assemble_document("selection", body, created_at = CREATED), p)
  list(path = p, tag = ats_integrity(body))
}

# case-2/4 body: exact VW factors with step 1 replaced by the simple average.
mk_body_non_vw <- function() {
  b <- committed_body
  ord <- dev_order(b)
  for (k in seq_along(ord)) b$development[[ord[k]]]$value <- f_vw[k]
  b$development[[ord[1]]]$value <- sa_step1
  b$development[[ord[1]]]$intent <- list(
    kind = "judgmental",
    rationale = "test fixture: step-1 simple-average factor forces a feasible non-VW CLFMdelta injection"
  )
  b
}

# case-3 body: an infeasible first factor (CLFMdelta returns foundSolution FALSE).
mk_body_infeasible <- function() {
  b <- committed_body
  ord <- dev_order(b)
  b$development[[ord[1]]]$value <- 0.5
  b$development[[ord[1]]]$intent <- list(
    kind = "judgmental",
    rationale = "test fixture: infeasible first factor 0.5 (no CLFMdelta solution)"
  )
  b
}

# case-5 body: a tail factor != 1 that MackChainLadder(tail = FALSE) cannot consume.
mk_body_tail <- function() {
  b <- committed_body
  b$tail <- list(
    value = 1.05,
    intent = list(kind = "judgmental", rationale = "test fixture: a tail the R run does not consume")
  )
  b
}

# case-6 body: appliesTo.triangleIntegrity pointing at a different triangle.
mk_body_wrong_triangle <- function() {
  b <- committed_body
  b$appliesTo$triangleIntegrity <- "0000000000000000"
  b
}

# --- cases (each returns list(ok, detail)) -----------------------------------

# 1. vw-match: the committed selection IS the VW fit; stamp is verified true and
#    the totals equal the no-selection run to 0 ULP, warnings absent.
case1 <- function() {
  out_sel <- tempfile(fileext = ".json")
  out_no <- tempfile(fileext = ".json")
  r1 <- run_cli("--in", TRI, "--selection", SEL, "--out", out_sel, "--created-at", CREATED)
  r0 <- run_cli("--in", TRI, "--out", out_no, "--created-at", CREATED)
  if (r1$status != 0 || r0$status != 0) {
    return(list(ok = FALSE, detail = sprintf("CLI failed: %s / %s", r1$output, r0$output)))
  }
  d1 <- ats_read_document(out_sel)
  d0 <- ats_read_document(out_no)
  ok <- identical(d1$result$appliesTo$selectionIntegrity, sel_doc$integrity) &&
    identical(d1$result$totals$unpaid, d0$result$totals$unpaid) &&
    identical(d1$result$totals$ultimate, d0$result$totals$ultimate) &&
    identical(d1$result$totals$standardError, d0$result$totals$standardError) &&
    is.null(d1$result$warnings)
  list(ok = ok, detail = sprintf(
    "stamp=%s unpaid(sel)=%s unpaid(no-sel)=%s warnings=%s",
    d1$result$appliesTo$selectionIntegrity,
    format(d1$result$totals$unpaid, digits = 16),
    format(d0$result$totals$unpaid, digits = 16),
    !is.null(d1$result$warnings)
  ))
}

# 2. feasible non-VW selection is ACTUALLY injected (unpaid moves to the
#    simple-average step-1 total; parameters.alpha echoes c(0, 1, ..., 1)).
case2 <- function() {
  s <- write_sel(mk_body_non_vw())
  out <- tempfile(fileext = ".json")
  r <- run_cli("--in", TRI, "--selection", s$path, "--out", out, "--created-at", CREATED)
  if (r$status != 0) return(list(ok = FALSE, detail = paste("CLI failed:", r$output)))
  d <- ats_read_document(out)
  unpaid <- d$result$totals$unpaid
  alpha_out <- as.numeric(unlist(d$result$parameters$alpha))
  ok <- abs(unpaid - expected_inj_unpaid) / abs(expected_inj_unpaid) <= 1e-9 &&
    identical(d$result$appliesTo$selectionIntegrity, s$tag) &&
    length(alpha_out) == 9L &&
    isTRUE(all.equal(alpha_out, c(0, rep(1, 8)), tolerance = 1e-12))
  list(ok = ok, detail = sprintf(
    "unpaid=%s expected=%s stamp=%s alpha=[%s]",
    format(unpaid, digits = 16), format(expected_inj_unpaid, digits = 16),
    d$result$appliesTo$selectionIntegrity, paste(alpha_out, collapse = ",")
  ))
}

# 3. infeasible selection: stamp is null and warnings say not-comparable.
case3 <- function() {
  s <- write_sel(mk_body_infeasible())
  out <- tempfile(fileext = ".json")
  r <- run_cli("--in", TRI, "--selection", s$path, "--out", out, "--created-at", CREATED)
  if (r$status != 0) return(list(ok = FALSE, detail = paste("CLI failed:", r$output)))
  d <- ats_read_document(out)
  w <- unlist(d$result$warnings)
  ok <- is.null(d$result$appliesTo$selectionIntegrity) &&
    !is.null(w) &&
    any(grepl("CLFMdelta|not-comparable", w)) &&
    any(grepl("NOT the supplied selection", w))
  list(ok = ok, detail = sprintf(
    "stamp_null=%s n_warnings=%s",
    is.null(d$result$appliesTo$selectionIntegrity), length(w)
  ))
}

# 4. --profile mack1993-vw on an injected non-VW fit is downgraded to
#    profile-less with a warning (never overclaimed).
case4 <- function() {
  s <- write_sel(mk_body_non_vw())
  out <- tempfile(fileext = ".json")
  r <- run_cli("--in", TRI, "--selection", s$path, "--out", out, "--created-at", CREATED, "--profile", "mack1993-vw")
  if (r$status != 0) return(list(ok = FALSE, detail = paste("CLI failed:", r$output)))
  d <- ats_read_document(out)
  w <- unlist(d$result$warnings)
  ok <- is.null(d$result$engine$conventionProfile) &&
    !is.null(w) && any(grepl("profile-less", w))
  list(ok = ok, detail = sprintf(
    "conventionProfile=%s profile_less_warning=%s",
    if (is.null(d$result$engine$conventionProfile)) "ABSENT" else d$result$engine$conventionProfile,
    !is.null(w) && any(grepl("profile-less", w))
  ))
}

# 5. tail-bearing selection is not silently ignored: null stamp + tail warning.
case5 <- function() {
  s <- write_sel(mk_body_tail())
  out <- tempfile(fileext = ".json")
  r <- run_cli("--in", TRI, "--selection", s$path, "--out", out, "--created-at", CREATED)
  if (r$status != 0) return(list(ok = FALSE, detail = paste("CLI failed:", r$output)))
  d <- ats_read_document(out)
  w <- unlist(d$result$warnings)
  ok <- is.null(d$result$appliesTo$selectionIntegrity) &&
    !is.null(w) && any(grepl("tail factor", w))
  list(ok = ok, detail = sprintf(
    "stamp_null=%s tail_warning=%s",
    is.null(d$result$appliesTo$selectionIntegrity), !is.null(w) && any(grepl("tail factor", w))
  ))
}

# 6. a selection for a DIFFERENT triangle is refused (non-zero exit).
case6 <- function() {
  s <- write_sel(mk_body_wrong_triangle())
  out <- tempfile(fileext = ".json")
  r <- run_cli("--in", TRI, "--selection", s$path, "--out", out, "--created-at", CREATED)
  ok <- r$status != 0 && grepl("applies to triangle", r$output)
  list(ok = ok, detail = sprintf("exit_status=%s message_matched=%s", r$status, grepl("applies to triangle", r$output)))
}

# --- run all, report per-case, fail loud -------------------------------------
cases <- list(
  "case 1: vw-match byte-identical, stamp verified" = case1,
  "case 2: feasible non-VW selection is injected" = case2,
  "case 3: infeasible selection -> null stamp + not-comparable" = case3,
  "case 4: mack1993-vw overclaim downgraded to profile-less" = case4,
  "case 5: tail-bearing selection not silently ignored" = case5,
  "case 6: selection for a different triangle refused" = case6
)

ok_all <- TRUE
for (nm in names(cases)) {
  res <- tryCatch(cases[[nm]](), error = function(e) list(ok = FALSE, detail = paste("ERROR:", conditionMessage(e))))
  cat(sprintf("[%s] %s | %s\n", if (isTRUE(res$ok)) "PASS" else "FAIL", nm, res$detail))
  ok_all <- ok_all && isTRUE(res$ok)
}

stopifnot(ok_all)
cat("test-run-mack-selection.R: all 6 selection-honesty cases OK\n")
