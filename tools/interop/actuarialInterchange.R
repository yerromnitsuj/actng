# actuarialInterchange.R — the R shore of the actuarial-interchange spec v1.
#
# Phase E, Task E1 (spec rev 2.1 sections 3.1, 3.5, 4.3, 5). A self-contained
# R source file (sourced, not a package): TriangleDoc <-> R matrix, selection
# injection via CLFMdelta with foundSolution honesty, MackChainLadder
# component extraction with est.sigma effective-parameter recording, and —
# the load-bearing part — a from-scratch RFC 8785 (JCS) canonical serializer +
# FNV-1a 64-bit hash that reproduces every committed jcs-vectors.json vector
# byte-for-byte. jsonlite gets JSON STRUCTURE but NOT the ECMAScript number
# layout, the UTF-16 key sort, or the well-formed lone-surrogate escape, so
# all three are implemented explicitly here (spec 3.1; the vector suite is the
# referee).
#
# Requires (installed under ~/.R-interop-lib): ChainLadder (>= 0.2.21),
# jsonlite (>= 2.0.0). Source this file, then call ats_test_jcs() to prove the
# serializer, and conformance.R to prove the Mack reproduction.
#
# Dependencies used from jsonlite: fromJSON (STRUCTURE only) + toJSON is NOT
# used for canonical output. All canonical bytes come from ats_canonical_json.

# Local interop library (ChainLadder 0.2.21, jsonlite 2.0.0, and its pinned
# compatible Deriv dependency live here) — make
# the file self-contained so `Rscript tools/interop/actuarialInterchange.R`
# sources cleanly on its own, not only when a caller pre-sets the path.
local({
  lib <- path.expand(Sys.getenv("ACTUARIAL_TS_R_LIBRARY", "~/.R-interop-lib"))
  if (dir.exists(lib) && !(lib %in% .libPaths())) .libPaths(c(lib, .libPaths()))
})

if (!"ChainLadder" %in% loadedNamespaces()) {
  suppressMessages(suppressWarnings(library(ChainLadder)))
}
if (!"jsonlite" %in% loadedNamespaces()) {
  suppressMessages(suppressWarnings(library(jsonlite)))
}

# ===========================================================================
# 1. Number formatting — ECMAScript Number::toString (base 10), per spec 3.1.
# ===========================================================================
# Mirrors interop/python/actuarial_interchange/_jcs.py::_format_number. R has
# no shortest-round-trip repr the way Python's repr does, so we search for the
# fewest significant digits whose %g rendering parses back to the exact double
# (correctly-rounded %g + round-trip == ECMAScript's shortest digits), then
# re-lay the digit string out with the ES algorithm.
#
# The round-trip check below parses candidates with jsonlite::fromJSON, NOT
# base R's as.numeric()/strtod: on at least one verified R build (4.6.1,
# macOS arm64) as.numeric() mis-rounds specific decimal strings by one ULP
# (e.g. "984888.6390497377" -> ...186f7 instead of the correctly-rounded
# ...186f8 that jsonlite, Python, and every JS engine agree on). That bug
# made this search silently fall through to a needlessly long, non-canonical
# 17-digit fallback whenever a fitted value landed on one of the mis-rounded
# strings — producing a valid-but-non-shortest number that fails byte-level
# integrity re-verification on every OTHER shore. jsonlite::fromJSON is
# already a hard dependency of this file and is independently exercised by
# ats_read_document, so this reuses a parser already proven correct here.

ats_shortest_repr <- function(x) {
  # Fewest significant digits d in 1..17 such that fromJSON(%.dg) == x.
  for (d in 1:17) {
    s <- sprintf(paste0("%.", d, "g"), x)
    if (jsonlite::fromJSON(s) == x) {
      return(s)
    }
  }
  sprintf("%.17g", x)
}

ats_format_number <- function(value, path = "$") {
  value <- as.numeric(value)
  if (is.nan(value) || is.infinite(value)) {
    stop(sprintf("non-finite number (%s) at %s", format(value), path))
  }
  if (value == 0) {
    return("0") # covers -0: JCS normalizes negative zero to "0" (in R -0 == 0)
  }

  sign <- if (value < 0) "-" else ""
  text <- ats_shortest_repr(abs(value))

  if (grepl("e", text, fixed = TRUE)) {
    parts <- strsplit(text, "e", fixed = TRUE)[[1]]
    mantissa <- parts[1]
    exponent <- as.integer(parts[2])
  } else {
    mantissa <- text
    exponent <- 0L
  }

  dot <- regexpr(".", mantissa, fixed = TRUE)
  if (dot == -1L) {
    int_part <- mantissa
    frac_part <- ""
  } else {
    int_part <- substr(mantissa, 1L, dot - 1L)
    frac_part <- substr(mantissa, dot + 1L, nchar(mantissa))
  }

  # value = int(digits) x 10^e10, digits stripped to the significant core.
  raw_digits <- paste0(int_part, frac_part)
  digits <- sub("^0+", "", raw_digits) # lstrip leading zeros
  e10 <- exponent - nchar(frac_part)
  stripped <- sub("0+$", "", digits) # rstrip trailing zeros
  e10 <- e10 + (nchar(digits) - nchar(stripped))
  digits <- stripped
  if (nchar(digits) == 0L) {
    return("0")
  }

  k <- nchar(digits)
  n <- e10 + k # the decimal point sits after the first n digits

  if (k <= n && n <= 21) {
    return(paste0(sign, digits, strrep("0", n - k)))
  }
  if (0 < n && n <= 21) {
    return(paste0(sign, substr(digits, 1L, n), ".", substr(digits, n + 1L, k)))
  }
  if (-6 < n && n <= 0) {
    return(paste0(sign, "0.", strrep("0", -n), digits))
  }
  e <- n - 1L
  exp_sign <- if (e >= 0) "+" else "-"
  head <- if (k > 1L) paste0(substr(digits, 1L, 1L), ".", substr(digits, 2L, k)) else substr(digits, 1L, 1L)
  paste0(sign, head, "e", exp_sign, abs(e))
}

# ===========================================================================
# 2. UTF-8 / WTF-8 byte decoder — recover code units incl. lone surrogates.
# ===========================================================================
# jsonlite loses lone surrogates on parse and R strings cannot hold one, so we
# operate on raw bytes: a lone-surrogate WTF-8 sequence (ED A0..BF ..) decodes
# to a code unit in 0xD800..0xDFFF; a valid 4-byte sequence decodes to an
# astral code point >= 0x10000 (emitted literally, never as a pair here).

ats_decode_units <- function(bytes) {
  bytes <- as.integer(bytes)
  n <- length(bytes)
  units <- integer(n) # upper bound; trimmed at the end
  u <- 0L
  i <- 1L
  while (i <= n) {
    b <- bytes[i]
    if (b < 0x80) {
      cp <- b
      i <- i + 1L
    } else if (bitwAnd(b, 0xE0) == 0xC0) {
      cp <- bitwOr(bitwShiftL(bitwAnd(b, 0x1F), 6L), bitwAnd(bytes[i + 1L], 0x3F))
      i <- i + 2L
    } else if (bitwAnd(b, 0xF0) == 0xE0) {
      cp <- bitwOr(
        bitwOr(bitwShiftL(bitwAnd(b, 0x0F), 12L), bitwShiftL(bitwAnd(bytes[i + 1L], 0x3F), 6L)),
        bitwAnd(bytes[i + 2L], 0x3F)
      )
      i <- i + 3L
    } else {
      cp <- bitwOr(
        bitwOr(
          bitwOr(bitwShiftL(bitwAnd(b, 0x07), 18L), bitwShiftL(bitwAnd(bytes[i + 1L], 0x3F), 12L)),
          bitwShiftL(bitwAnd(bytes[i + 2L], 0x3F), 6L)
        ),
        bitwAnd(bytes[i + 3L], 0x3F)
      )
      i <- i + 4L
    }
    u <- u + 1L
    units[u] <- cp
  }
  if (u == 0L) integer(0) else units[1:u]
}

# UTF-8 bytes of an R string (surrogate-free strings only reach re-encoding).
ats_string_bytes <- function(s) {
  as.integer(charToRaw(enc2utf8(s)))
}

# ===========================================================================
# 3. String escaping — JSON.stringify minimal escaping + ES2019 well-formed.
# ===========================================================================
# Named escapes for \b \t \n \f \r " \ ; \u00XX for other control chars;
# \udXXX (lowercase) for UNPAIRED surrogate code units; everything else
# literal UTF-8 (spec 3.1 / _jcs.py::_format_string).

.ats_named_escapes <- c(
  "8" = "\\b", "9" = "\\t", "10" = "\\n", "12" = "\\f", "13" = "\\r",
  "34" = "\\\"", "92" = "\\\\"
)

ats_escape_string <- function(s) {
  units <- ats_decode_units(ats_string_bytes(s))
  out <- character(length(units) + 2L)
  out[1] <- "\""
  o <- 1L
  for (cp in units) {
    o <- o + 1L
    named <- .ats_named_escapes[as.character(cp)]
    if (!is.na(named)) {
      out[o] <- named
    } else if (cp < 0x20) {
      out[o] <- sprintf("\\u%04x", cp)
    } else if (cp >= 0xD800 && cp <= 0xDFFF) {
      # Lone surrogate (paired astral chars already decoded to one code point).
      out[o] <- sprintf("\\u%04x", cp)
    } else {
      out[o] <- intToUtf8(cp)
    }
  }
  out[o + 1L] <- "\""
  paste0(out[1:(o + 1L)], collapse = "")
}

# ===========================================================================
# 4. UTF-16 code-unit key sort (spec 3.1: bytewise order of UTF-16-BE).
# ===========================================================================

ats_utf16be_sortkey <- function(s) {
  units <- ats_decode_units(ats_string_bytes(s))
  bytes <- integer(0)
  for (cp in units) {
    if (cp >= 0x10000) {
      c2 <- cp - 0x10000
      hi <- 0xD800 + bitwShiftR(c2, 10L)
      lo <- 0xDC00 + bitwAnd(c2, 0x3FF)
      bytes <- c(bytes, bitwShiftR(hi, 8L), bitwAnd(hi, 0xFF), bitwShiftR(lo, 8L), bitwAnd(lo, 0xFF))
    } else {
      bytes <- c(bytes, bitwShiftR(cp, 8L), bitwAnd(cp, 0xFF))
    }
  }
  # Fixed-width hex per byte: lexicographic order == bytewise order.
  paste(sprintf("%02x", bytes), collapse = "")
}

# ===========================================================================
# 5. Canonical JSON (RFC 8785 / JCS) over native R structures.
# ===========================================================================
# Convention (unambiguous, matched to fromJSON(simplifyVector=FALSE)):
#   NULL / scalar NA            -> null
#   logical (len 1)             -> true|false
#   character (len 1)           -> escaped string
#   numeric/integer (len 1)     -> ES number
#   atomic vector (len != 1)    -> array of scalars
#   list with names             -> object (empty named list -> {})
#   list without names          -> array  (empty unnamed list -> [])
# Empty {} vs [] is distinguished exactly as fromJSON does: names present
# (character(0)) => object, names NULL => array (verified empirically).

ats_canonical_json <- function(x, path = "$") {
  if (is.null(x)) {
    return("null")
  }
  # Scalar NA (any atomic type) is unobserved -> null.
  if (is.atomic(x) && length(x) == 1L && is.na(x)) {
    return("null")
  }
  if (is.logical(x) && length(x) == 1L) {
    return(if (isTRUE(x)) "true" else "false")
  }
  if (is.character(x) && length(x) == 1L) {
    return(ats_escape_string(x))
  }
  if ((is.numeric(x) || is.integer(x)) && length(x) == 1L) {
    return(ats_format_number(x, path))
  }
  if (is.atomic(x) && !is.list(x)) {
    # Length != 1 atomic vector -> JSON array of scalars.
    parts <- vapply(
      seq_along(x),
      function(i) ats_canonical_json(x[i], sprintf("%s[%d]", path, i)),
      character(1)
    )
    return(paste0("[", paste(parts, collapse = ","), "]"))
  }
  if (is.list(x)) {
    nms <- names(x)
    is_object <- !is.null(nms) && all(nzchar(nms))
    if (length(x) == 0L) {
      # fromJSON: {} -> names character(0) (not null); [] -> names NULL.
      return(if (!is.null(nms)) "{}" else "[]")
    }
    if (is_object) {
      # method = "radix" sorts in the C locale (bytewise), per ?order — the
      # sortkeys are ASCII hex, so this IS UTF-16BE byte order. The default
      # "auto" method collates per LC_COLLATE/ICU, and Danish/Norwegian
      # collation reorders the "aa" digraph, breaking canonical-byte identity.
      order_idx <- order(vapply(nms, ats_utf16be_sortkey, character(1)), method = "radix")
      parts <- vapply(
        order_idx,
        function(i) {
          paste0(
            ats_escape_string(nms[i]), ":",
            ats_canonical_json(x[[i]], sprintf("%s.%s", path, nms[i]))
          )
        },
        character(1)
      )
      return(paste0("{", paste(parts, collapse = ","), "}"))
    }
    parts <- vapply(
      seq_along(x),
      function(i) ats_canonical_json(x[[i]], sprintf("%s[%d]", path, i)),
      character(1)
    )
    return(paste0("[", paste(parts, collapse = ","), "]"))
  }
  stop(sprintf("unsupported type (%s) at %s", class(x)[1], path))
}

# ===========================================================================
# 6. FNV-1a 64-bit — over the UTF-8 bytes of the canonical text (spec 3.1).
# ===========================================================================
# R has no unsigned 64-bit integer, so the hash is held as four 16-bit limbs
# (low to high) in doubles; the multiply is a 4x4 schoolbook product kept mod
# 2^64. Integrity AID only (not collision resistant), matching _jcs.py.

# FNV offset basis 0xCBF29CE484222325 -> limbs low..high.
.ats_fnv_offset <- c(0x2325, 0x8422, 0x9CE4, 0xCBF2)
# FNV prime 0x100000001b3 = 256 * 2^32 + 435 -> limbs 0x01B3, 0, 0x0100, 0.
.ats_fnv_prime <- c(435, 0, 256, 0)

.ats_mul64_limbs <- function(a, b) {
  prod <- numeric(4)
  for (i in 1:4) {
    for (j in 1:4) {
      k <- i + j - 1L
      if (k <= 4L) {
        prod[k] <- prod[k] + a[i] * b[j]
      }
    }
  }
  out <- numeric(4)
  carry <- 0
  for (k in 1:4) {
    t <- prod[k] + carry
    out[k] <- t %% 65536
    carry <- floor(t / 65536)
  }
  out # low 64 bits (higher limbs discarded mod 2^64)
}

ats_fnv1a64 <- function(text) {
  bytes <- ats_string_bytes(text)
  h <- .ats_fnv_offset
  for (b in bytes) {
    # XOR the byte into the low 8 bits of limb 0.
    low_byte <- h[1] %% 256
    h[1] <- h[1] - low_byte + bitwXor(as.integer(low_byte), as.integer(b))
    h <- .ats_mul64_limbs(h, .ats_fnv_prime)
  }
  sprintf("%04x%04x%04x%04x", h[4], h[3], h[2], h[1])
}

# ===========================================================================
# 7. ats_test_jcs — reproduce every committed vector byte-for-byte.
# ===========================================================================

# A lone high surrogate string (code unit U+D800), built from WTF-8 bytes
# because R strings and jsonlite cannot carry one (see probe findings).
.ats_lone_surrogate <- function() {
  s <- rawToChar(as.raw(c(0xED, 0xA0, 0x80)))
  Encoding(s) <- "UTF-8"
  s
}

ats_test_jcs <- function(vectors_path = NULL, verbose = TRUE) {
  if (is.null(vectors_path)) {
    vectors_path <- file.path(ats_repo_root(), "schema", "interchange", "1.0", "jcs-vectors.json")
  }
  spec <- fromJSON(vectors_path, simplifyVector = FALSE)
  vectors <- spec$vectors
  passed <- 0L
  failed <- 0L
  for (vec in vectors) {
    name <- vec$name
    expected <- vec$canonical
    if (identical(name, "lone-surrogate-escaped")) {
      # jsonlite substitutes the lone surrogate with '?' on parse and R cannot
      # hold one in a normal string, so reconstruct the value the vector
      # DESCRIBES from WTF-8 bytes. The serializer is exercised faithfully;
      # only jsonlite's lossy input parse is compensated for.
      value <- list(k = .ats_lone_surrogate())
    } else {
      value <- vec$value
    }
    actual <- tryCatch(ats_canonical_json(value), error = function(e) paste0("<error: ", conditionMessage(e), ">"))
    ok <- identical(actual, expected)
    if (ok) {
      passed <- passed + 1L
    } else {
      failed <- failed + 1L
      if (verbose) {
        cat(sprintf("  FAIL %-28s expected %s\n%36s got      %s\n", name, expected, "", actual))
      }
    }
  }
  if (verbose) {
    cat(sprintf("ats_test_jcs: %d/%d vectors passed", passed, passed + failed))
    cat(if (failed == 0L) "  [ALL PASS]\n" else sprintf("  [%d FAILED]\n", failed))
  }
  invisible(list(passed = passed, failed = failed, total = passed + failed))
}

# ===========================================================================
# 8. Repo-root discovery (so recipes run from anywhere).
# ===========================================================================

ats_repo_root <- function() {
  # This file lives at <repo>/tools/interop/actuarialInterchange.R.
  here <- tryCatch(
    {
      args <- commandArgs(trailingOnly = FALSE)
      file_arg <- sub("^--file=", "", args[grep("^--file=", args)])
      if (length(file_arg) == 1L && nzchar(file_arg)) normalizePath(dirname(file_arg)) else NA_character_
    },
    error = function(e) NA_character_
  )
  candidates <- c(here, getwd())
  for (start in candidates) {
    if (is.na(start)) next
    dir <- start
    for (.i in 1:8) {
      if (file.exists(file.path(dir, "schema", "interchange", "1.0", "jcs-vectors.json"))) {
        return(dir)
      }
      parent <- dirname(dir)
      if (identical(parent, dir)) break
      dir <- parent
    }
  }
  # Fallback: two levels up from this source dir.
  if (!is.na(here)) normalizePath(file.path(here, "..", "..")) else getwd()
}

# ===========================================================================
# 9. TriangleDoc <-> R matrix (NA/null preservation both ways) + integrity.
# ===========================================================================

ats_body_key <- function(kind) {
  switch(kind,
    "triangle" = "triangle",
    "selection" = "selection",
    "method-result" = "result",
    "stochastic-result" = "result",
    "study" = "study",
    "crosscheck-report" = "report",
    "diagnostic-definition" = "diagnosticDefinition",
    stop(sprintf("no semantic-body key for kind '%s'", kind))
  )
}

# Integrity over the SEMANTIC BODY only (spec 3.1) — never the envelope.
ats_integrity <- function(body) {
  ats_fnv1a64(ats_canonical_json(body))
}

# Parsed document (list) -> numeric matrix with NA for null cells.
ats_triangle_to_matrix <- function(doc) {
  tri <- if (!is.null(doc$triangle)) doc$triangle else doc # accept body or full doc
  vals <- tri$values
  ages <- tri$agesMonths
  nr <- length(vals)
  nc <- length(ages)
  m <- matrix(NA_real_, nrow = nr, ncol = nc)
  for (i in seq_len(nr)) {
    row <- vals[[i]]
    for (j in seq_len(nc)) {
      cell <- if (j <= length(row)) row[[j]] else NULL
      if (!is.null(cell) && !is.na(cell)) {
        m[i, j] <- as.numeric(cell)
      }
    }
  }
  origins <- vapply(tri$origins, function(o) as.character(o$label), character(1))
  age_labels <- vapply(ages, function(a) as.character(as.integer(a)), character(1))
  dimnames(m) <- list(origin = origins, dev = age_labels)
  m
}

# R matrix -> TriangleDoc (full envelope). NA -> JSON null. Reproduces the
# committed integrity tag when given the same measure/origins/ages/values.
ats_matrix_to_triangle_doc <- function(m,
                                       measure = "paid",
                                       cumulative = TRUE,
                                       origin_length_months = 12L,
                                       origins_start = NULL,
                                       ages_months = NULL,
                                       valuation_date,
                                       created_at = "2026-07-17T00:00:00Z",
                                       units = NULL,
                                       basis = NULL,
                                       segment = NULL) {
  nr <- nrow(m)
  nc <- ncol(m)
  origin_labels <- rownames(m)
  if (is.null(origin_labels)) origin_labels <- as.character(seq_len(nr))
  if (is.null(ages_months)) {
    col_labels <- colnames(m)
    ages_months <- if (!is.null(col_labels)) as.integer(col_labels) else as.integer(seq_len(nc) * origin_length_months)
  }
  if (is.null(origins_start)) {
    origins_start <- vapply(origin_labels, function(lbl) {
      if (grepl("^[0-9]{4}$", lbl)) paste0(lbl, "-01-01") else stop(sprintf("origin '%s' needs an explicit start date", lbl))
    }, character(1))
  }

  origins <- lapply(seq_len(nr), function(i) {
    list(label = origin_labels[i], start = origins_start[i])
  })
  values <- lapply(seq_len(nr), function(i) {
    lapply(seq_len(nc), function(j) {
      v <- m[i, j]
      if (is.na(v)) NULL else as.numeric(v)
    })
  })

  body <- list(
    measure = measure,
    cumulative = isTRUE(cumulative),
    originLengthMonths = as.integer(origin_length_months),
    origins = origins,
    agesMonths = lapply(ages_months, as.integer),
    valuationDate = valuation_date,
    values = values
  )
  if (!is.null(basis)) body$basis <- basis
  if (!is.null(units)) body$units <- units
  if (!is.null(segment)) body$segment <- segment

  ats_assemble_document("triangle", body, created_at = created_at)
}

# ===========================================================================
# 10. Selection injection via CLFMdelta (foundSolution honesty, spec 3.2/5).
# ===========================================================================
# CLFMdelta(Triangle, selected) solves for per-period delta such that
# coef(chainladder(Triangle, delta)) reproduces the selected age-to-age
# factors, with a per-element foundSolution flag; an infeasible selection is
# surfaced as a not-comparable warning, NEVER silently accepted. NB the
# alpha/delta trap: MackChainLadder alpha (1=VW, 0=simple, 2=regression) is
# NOT chainladder's delta scale (alpha = 2 - delta) — CLFMdelta returns the
# delta scale, which we report as-is without conflating it with alpha.

# Selected development factors from a selection object, ordered by
# fromAgeMonths (one per development step) -- the shared prep step both
# CLFMdelta injection and the vw-match check need before doing anything else.
.ats_selected_factors <- function(sel) {
  dev <- sel$development
  from_ages <- vapply(dev, function(d) as.numeric(d$fromAgeMonths), numeric(1))
  vapply(dev[order(from_ages)], function(d) as.numeric(d$value), numeric(1))
}

ats_selection_to_delta <- function(triangle, selection_doc, tolerance = 5e-4) {
  sel <- if (!is.null(selection_doc$selection)) selection_doc$selection else selection_doc
  selected <- .ats_selected_factors(sel)

  if (!inherits(triangle, "triangle")) {
    triangle <- as.triangle(triangle)
  }
  result <- tryCatch(
    CLFMdelta(triangle, selected = selected, tolerance = tolerance),
    error = function(e) structure(list(error = conditionMessage(e)), class = "ats_clfm_error")
  )
  if (inherits(result, "ats_clfm_error")) {
    return(list(
      delta = rep(NA_real_, length(selected)),
      foundSolution = rep(FALSE, length(selected)),
      selected = selected,
      warnings = sprintf(
        "CLFMdelta could not solve for the selected factors: %s (not-comparable)",
        result$error
      )
    ))
  }

  found <- attr(result, "foundSolution")
  if (is.null(found)) found <- !is.na(as.numeric(result))
  delta <- as.numeric(result)
  warnings <- character(0)
  if (!all(found)) {
    infeasible <- which(!found)
    warnings <- sprintf(
      "CLFMdelta found no feasible delta for development step(s) %s; those factors are not-comparable to an R-native Mack run (injection honesty, spec 3.2/5)",
      paste(infeasible, collapse = ", ")
    )
  }
  list(delta = delta, foundSolution = as.logical(found), selected = selected, warnings = warnings)
}

# Decide how run-mack.R should honor a selection document: "vw-match" (the
# selection IS the alpha=1 fit's factors -> reuse today's exact path),
# "injected" (CLFMdelta solved for a per-period alpha), or "not-injectable"
# (fit runs WITHOUT the selection; stamp must be null; warnings say so).
ats_mack_selection_plan <- function(triangle, selection_doc, match_tol = 1e-9) {
  sel <- selection_doc$selection
  if (!is.null(sel$tail) && !isTRUE(as.numeric(sel$tail$value) == 1)) {
    return(list(mode = "not-injectable", alpha = 1, warnings =
      "the selection carries a tail factor != 1, which rcl:MackChainLadder (tail = FALSE) does not consume; the result was computed WITHOUT the selection and appliesTo.selectionIntegrity is null (not-comparable)"))
  }
  selected <- .ats_selected_factors(sel)
  if (length(selected) != ncol(triangle) - 1L) {
    stop(sprintf("selection has %d development factors; triangle needs %d",
                 length(selected), ncol(triangle) - 1L))
  }
  f_vw <- as.numeric(suppressWarnings(
    MackChainLadder(triangle, alpha = 1, est.sigma = "Mack"))$f)[seq_along(selected)]
  if (all(abs(selected - f_vw) / pmax(abs(f_vw), 1) <= match_tol)) {
    return(list(mode = "vw-match", alpha = 1, warnings = character(0)))
  }
  inj <- ats_selection_to_delta(triangle, selection_doc)
  if (all(inj$foundSolution)) {
    return(list(mode = "injected", alpha = 2 - inj$delta, warnings = inj$warnings))
  }
  list(mode = "not-injectable", alpha = 1, warnings = c(inj$warnings,
    "the result was computed under volume-weighted (alpha = 1) factors, NOT the supplied selection; appliesTo.selectionIntegrity is null (injection honesty, spec 3.2/5)"))
}

# ===========================================================================
# 11. MackChainLadder -> MethodResultDoc (est.sigma effective recording).
# ===========================================================================

# Detect the est.sigma the fit ACTUALLY used, catching MackChainLadder's
# silent log-linear -> Mack auto-fallback on a poor regression fit (p > 0.05).
ats_detect_effective_est_sigma <- function(triangle, alpha, requested) {
  if (is.numeric(requested)) {
    return("user-supplied")
  }
  if (identical(requested, "Mack")) {
    return("Mack") # explicitly requested; no fallback possible
  }
  # requested == "log-linear": compare the sigma vector against a Mack run;
  # if identical, the log-linear regression fell back to Mack's approximation.
  fit_ll <- suppressWarnings(MackChainLadder(triangle, alpha = alpha, est.sigma = "log-linear"))
  fit_mk <- suppressWarnings(MackChainLadder(triangle, alpha = alpha, est.sigma = "Mack"))
  same <- isTRUE(all.equal(as.numeric(fit_ll$sigma), as.numeric(fit_mk$sigma), tolerance = 1e-12))
  if (same) "Mack" else "log-linear"
}

# Pull the requested est.sigma / alpha out of a fit's stored call.
.ats_fit_requested <- function(fit) {
  call_list <- as.list(fit$call)
  est_sigma <- if (!is.null(call_list[["est.sigma"]])) tryCatch(eval(call_list[["est.sigma"]]), error = function(e) "log-linear") else "log-linear"
  alpha <- if (!is.null(fit$alpha)) as.numeric(fit$alpha) else
    if (!is.null(call_list[["alpha"]])) as.numeric(eval(call_list[["alpha"]])) else 1
  if (length(alpha) > 1L && all(alpha == alpha[1])) alpha <- alpha[1]
  list(est_sigma = est_sigma, alpha = alpha)
}

ats_extract_mack_result <- function(fit, triangle_doc, selection_doc = NULL,
                                    convention_profile = "mack1993-vw",
                                    created_at = "2026-07-17T00:00:00Z",
                                    extra_warnings = character(0)) {
  if (!inherits(fit, "MackChainLadder")) {
    stop("ats_extract_mack_result expects a MackChainLadder fit")
  }
  triangle_integrity <- if (!is.null(triangle_doc$integrity)) triangle_doc$integrity else ats_integrity(triangle_doc$triangle)
  selection_integrity <- NULL
  if (!is.null(selection_doc)) {
    selection_integrity <- if (!is.null(selection_doc$integrity)) selection_doc$integrity else ats_integrity(selection_doc$selection)
  }

  so <- summary(fit)$ByOrigin
  origins <- rownames(so)
  ultimate <- as.numeric(so[["Ultimate"]])
  unpaid <- as.numeric(so[["IBNR"]])
  se <- as.numeric(so[["Mack.S.E"]])

  rows <- lapply(seq_along(origins), function(i) {
    row <- list(origin = origins[i], ultimate = ultimate[i], unpaid = unpaid[i])
    # standardError only where the engine produced a finite value (a fully
    # developed origin yields exactly 0 here, matching the committed fixtures).
    # A non-finite SE OMITS the key entirely — the cross-shore contract is
    # number-or-ABSENT, never null (TS schema is .optional() not .nullable();
    # Python omits it too). Emitting "standardError":null would break integrity
    # re-verification on the other shores. (Contrast selectionIntegrity, whose
    # schema IS .nullable() and so uses list(NULL) correctly elsewhere.)
    if (is.finite(se[i])) {
      row$standardError <- se[i]
    }
    row
  })

  totals <- list(
    ultimate = sum(ultimate),
    unpaid = sum(unpaid),
    standardError = as.numeric(fit$Total.Mack.S.E)
  )

  req <- .ats_fit_requested(fit)
  effective <- ats_detect_effective_est_sigma(fit$Triangle, req$alpha, req$est_sigma)

  warnings <- character(0)
  if (!identical(as.character(req$est_sigma), as.character(effective))) {
    warnings <- c(warnings, sprintf(
      "MackChainLadder est.sigma auto-fallback fired: requested '%s', effective '%s' (p > 0.05 on the log-linear fit); recorded in effectiveParameters",
      req$est_sigma, effective
    ))
  }
  warnings <- c(warnings, extra_warnings)

  applies_to <- list(triangleIntegrity = triangle_integrity)
  if (is.null(selection_integrity)) {
    applies_to["selectionIntegrity"] <- list(NULL)
  } else {
    applies_to$selectionIntegrity <- selection_integrity
  }

  # conventionProfile is .optional() (not .nullable()): a downgraded run
  # OMITS the key rather than emitting "conventionProfile":null.
  engine <- list(
    name = "R ChainLadder",
    version = as.character(utils::packageVersion("ChainLadder"))
  )
  if (!is.null(convention_profile)) engine$conventionProfile <- convention_profile

  body <- list(
    appliesTo = applies_to,
    engine = engine,
    method = "rcl:MackChainLadder",
    parameters = list(
      # A per-period alpha (injected selection) echoes as a JSON array; a scalar
      # (VW or simple) stays a number, keeping the committed path byte-identical.
      alpha = if (length(req$alpha) > 1L) as.list(req$alpha) else req$alpha,
      est.sigma = as.character(req$est_sigma),
      tail = FALSE
    ),
    effectiveParameters = list(est.sigma = as.character(effective)),
    rows = rows,
    totals = totals
  )
  if (length(warnings) > 0L) {
    body$warnings <- as.list(warnings)
  }

  ats_assemble_document("method-result", body, created_at = created_at)
}

# ===========================================================================
# 12. Envelope assembly + read/write with version acceptance (spec 3.1/3.5).
# ===========================================================================

ats_assemble_document <- function(kind, body, created_at = "2026-07-17T00:00:00Z",
                                  generator = list(name = "actuarialInterchange.R", version = "0.2.0"),
                                  extensions = NULL, governance = NULL) {
  doc <- list(
    interchangeVersion = "1.1.0",
    kind = kind,
    generator = generator,
    createdAt = created_at
  )
  doc[[ats_body_key(kind)]] <- body
  if (!is.null(governance)) doc$governance <- governance
  if (!is.null(extensions)) doc$extensions <- extensions
  doc$integrity <- ats_integrity(body)
  doc
}

ats_write_document <- function(doc, path) {
  # Re-stamp integrity from the current semantic body so a hand-edited body
  # can never carry a stale tag.
  kind <- doc$kind
  body <- doc[[ats_body_key(kind)]]
  doc$integrity <- ats_integrity(body)
  writeLines(ats_canonical_json(doc), path)
  invisible(path)
}

# Wrong-major documents stop() with condition class interchange_version_error.
.ats_version_error <- function(message) {
  structure(
    class = c("interchange_version_error", "error", "condition"),
    list(message = message, call = sys.call(-1))
  )
}

ats_read_document <- function(path, verify_integrity = TRUE) {
  doc <- fromJSON(path, simplifyVector = FALSE)
  version <- doc$interchangeVersion
  if (is.null(version) || !grepl("^[0-9]+\\.[0-9]+\\.[0-9]+$", version)) {
    stop(sprintf("malformed interchangeVersion '%s' (expected MAJOR.MINOR.PATCH)", version))
  }
  major <- as.integer(strsplit(version, ".", fixed = TRUE)[[1]][1])
  if (major != 1L) {
    stop(.ats_version_error(sprintf(
      "interchangeVersion %s has major %d; this adapter reads major 1 only", version, major
    )))
  }
  kind <- doc$kind

  # Spec 3.5 applies per document: study/bundle embed complete documents,
  # each subject to the same major-acceptance rule (Python/TS parity).
  embedded <- if (identical(kind, "study")) {
    c(doc$study$triangles, doc$study$selections, doc$study$supportingResults)
  } else if (identical(kind, "bundle")) {
    c(doc$interchange$triangles, doc$interchange$selections, doc$interchange$results,
      doc$interchange$diagnosticDefinitions)
  } else NULL
  for (inner in embedded) {
    v <- inner$interchangeVersion
    if (is.null(v) || !grepl("^[0-9]+\\.[0-9]+\\.[0-9]+$", v)) {
      stop(sprintf("embedded document: malformed interchangeVersion '%s'", v))
    }
    m <- as.integer(strsplit(v, ".", fixed = TRUE)[[1]][1])
    if (m != 1L) {
      stop(.ats_version_error(sprintf(
        "embedded document: interchangeVersion %s has major %d; this adapter reads major 1 only", v, m
      )))
    }
  }

  if (verify_integrity && !is.null(doc$integrity) && kind != "bundle") {
    body <- doc[[ats_body_key(kind)]]
    computed <- ats_integrity(body)
    if (!identical(computed, doc$integrity)) {
      stop(sprintf(
        "integrity mismatch reading %s: document states '%s', semantic body hashes to '%s'",
        basename(path), doc$integrity, computed
      ))
    }
  }
  doc
}

# ===========================================================================
# 13. Narrow diagnostic-definition conformance (identity + aggregate replay).
# ===========================================================================

ats_diagnostic_tag <- function(kind, key, value) {
  body <- list(identityVersion = 1, kind = kind)
  body[[key]] <- value
  paste0("fnv1a64-jcs-v1:", ats_fnv1a64(ats_canonical_json(body)))
}

ats_diag_dependencies <- function(expression) {
  op <- expression$op
  if (op %in% c("measure", "claim-layer")) return(expression$measureId)
  if (identical(op, "add")) return(unique(unlist(lapply(expression$terms, ats_diag_dependencies))))
  if (identical(op, "subtract")) {
    return(unique(c(ats_diag_dependencies(expression$left), ats_diag_dependencies(expression$right))))
  }
  stop(sprintf("unknown diagnostic expression operator '%s'", op))
}

ats_by_id <- function(items, key = "id") {
  result <- list()
  for (item in items) result[[item[[key]]]] <- item
  result
}

# ECMAScript's canonical SDK orders identifiers by UTF-16 code units. R's
# locale/code-point sort differs for astral characters, so identity-bearing
# collections use this explicit comparator on every shore.
ats_utf16_units <- function(value) {
  codepoints <- utf8ToInt(enc2utf8(value))
  unlist(lapply(codepoints, function(point) {
    if (point <= 0xFFFF) return(point)
    adjusted <- point - 0x10000
    c(0xD800 + adjusted %/% 0x400, 0xDC00 + adjusted %% 0x400)
  }), use.names = FALSE)
}

ats_utf16_less <- function(left, right) {
  a <- ats_utf16_units(left)
  b <- ats_utf16_units(right)
  shared <- min(length(a), length(b))
  if (shared > 0L) {
    different <- which(a[seq_len(shared)] != b[seq_len(shared)])
    if (length(different) > 0L) return(a[different[[1]]] < b[different[[1]]])
  }
  length(a) < length(b)
}

ats_sort_utf16 <- function(values) {
  result <- as.character(values)
  if (length(result) < 2L) return(result)
  for (index in 2:length(result)) {
    cursor <- index
    while (cursor > 1L && ats_utf16_less(result[[cursor]], result[[cursor - 1L]])) {
      swap <- result[[cursor - 1L]]
      result[[cursor - 1L]] <- result[[cursor]]
      result[[cursor]] <- swap
      cursor <- cursor - 1L
    }
  }
  result
}

ats_select_fields <- function(item, fields) {
  result <- setNames(vector("list", length(fields)), fields)
  # Single-bracket assignment preserves explicit JSON nulls; [[<- NULL would
  # silently delete the field and change the cross-shore identity scope.
  for (field in fields) result[field] <- list(item[[field]])
  result
}

ats_diagnostic_identities <- function(definition) {
  formulas <- ats_by_id(definition$formulas)
  measures <- ats_by_id(definition$measures)
  derivations <- ats_by_id(definition$derivedMeasures, "outputMeasureId")
  populations <- ats_by_id(definition$countPopulations)
  exposures <- ats_by_id(definition$exposureBases)
  amounts <- ats_by_id(definition$amountBases)
  formula_ids <- ats_sort_utf16(names(formulas))
  formula_tags <- setNames(lapply(formula_ids, function(id) {
    ats_diagnostic_tag("diagnostic-formula", "formula", formulas[[id]])
  }), formula_ids)

  transitive <- function(roots) {
    found <- character(0)
    stack <- roots
    while (length(stack) > 0L) {
      id <- stack[[length(stack)]]
      stack <- stack[-length(stack)]
      if (id %in% found) next
      found <- c(found, id)
      if (!is.null(derivations[[id]])) {
        stack <- c(stack, ats_diag_dependencies(derivations[[id]]$expression))
      }
    }
    ats_sort_utf16(found)
  }

  calculations <- list()
  for (instance in definition$instances) {
    deps <- transitive(unique(unlist(lapply(instance$bindings, ats_diag_dependencies))))
    selected <- Filter(Negate(is.null), lapply(deps, function(id) measures[[id]]))
    collect <- function(field) ats_sort_utf16(unique(Filter(Negate(is.null), lapply(selected, function(x) x[[field]]))))
    pop_ids <- collect("countPopulationId")
    exposure_ids <- collect("exposureBasisId")
    amount_ids <- collect("basisId")
    scope <- list(
      formulaFingerprint = formula_tags[[instance$formulaId]],
      instance = ats_select_fields(instance, c("id", "version", "formulaId", "bindings")),
      lossRowGrain = definition$lossRowGrain,
      measures = lapply(selected, ats_select_fields, fields = c("id", "source", "kind", "unit", "developmentSemantics", "aggregation", "missing", "basisId", "countPopulationId", "exposureBasisId", "exposureTiming")),
      countPopulations = lapply(pop_ids, function(id) ats_select_fields(populations[[id]], c("id", "subject", "unit", "attributes"))),
      exposureBases = lapply(exposure_ids, function(id) ats_select_fields(exposures[[id]], c("id", "basis", "unit", "attributes"))),
      amountBases = lapply(amount_ids, function(id) ats_select_fields(amounts[[id]], c("id", "currency", "perspective", "components", "attributes"))),
      derivedMeasures = Filter(function(item) item$outputMeasureId %in% deps, definition$derivedMeasures)
    )
    calculations[[instance$id]] <- ats_diagnostic_tag("diagnostic-calculation", "calculation", scope)
  }
  calculation_ids <- ats_sort_utf16(names(calculations))
  calculations <- calculations[calculation_ids]
  list(
    algorithm = "fnv1a64-jcs-v1",
    formulaById = formula_tags,
    calculationByInstanceId = calculations,
    definition = ats_diagnostic_tag("diagnostic-definition", "definition", definition)
  )
}

ats_diag_exact <- function(value, allowed, path) {
  if (!is.list(value) || is.null(names(value))) stop(sprintf("%s must be an object", path))
  unknown <- setdiff(names(value), allowed)
  if (length(unknown) > 0L) stop(sprintf("unsupported diagnostic behavior at %s.%s", path, ats_sort_utf16(unknown)[[1]]))
  missing <- setdiff(allowed, names(value))
  if (length(missing) > 0L) stop(sprintf("missing normalized diagnostic field at %s.%s", path, ats_sort_utf16(missing)[[1]]))
}

ats_diag_token <- function(value, path) {
  if (!is.character(value) || length(value) != 1L || is.na(value) || !nzchar(value) ||
      grepl("^[\\x09-\\x0d ]|[\\x09-\\x0d ]$", value, perl = TRUE))
    stop(sprintf("invalid diagnostic token at %s", path))
}

ats_diag_number <- function(value, path, nonnegative = FALSE, integer = FALSE) {
  if (!is.numeric(value) || length(value) != 1L || !is.finite(value) ||
      (nonnegative && value < 0) || (integer && (value != trunc(value) || abs(value) > 2^53 - 1)))
    stop(sprintf("invalid diagnostic number at %s", path))
}

ats_diag_enum <- function(value, choices, path) {
  if (!is.character(value) || length(value) != 1L || is.na(value) || !(value %in% choices))
    stop(sprintf("unsupported diagnostic enum at %s", path))
}

# An environment stack avoids quadratic list slicing at the 100,000-node
# definition boundary. Entries are removed immediately after visiting them.
ats_diag_stack <- function(initial) {
  entries <- new.env(hash = TRUE, parent = emptyenv())
  entries[["1"]] <- initial
  count <- 1L
  list(
    empty = function() count == 0L,
    push = function(value) { count <<- count + 1L; entries[[as.character(count)]] <- value },
    pop = function() {
      key <- as.character(count); value <- entries[[key]]
      rm(list = key, envir = entries); count <<- count - 1L
      value
    }
  )
}

ats_validate_diag_scalars <- function(definition) {
  enums <- list(
    lossRowGrain = c("claim", "aggregate"),
    developmentSemantics = c("cumulative", "incremental", "point-in-time", "unknown"),
    aggregation = "sum", missing = c("unknown", "zero"), exposureTiming = c("origin-static", "valuation-specific"),
    subject = c("claim", "claimant", "policy", "occurrence", "other", "unknown"),
    basis = c("earned", "written", "in-force", "other", "unknown"),
    perspective = c("gross", "net", "ceded", "other", "unknown"), treatment = c("included", "excluded", "unknown"),
    application = c("claim", "occurrence", "policy", "source-defined"), actor = c("caller", "source"),
    denominatorPolicy = "positive-or-null", severity = c("warning", "fail"),
    operator = c("lt", "lte", "eq", "neq", "gte", "gt"), missingInput = c("not-evaluated", "finding"),
    direction = c("nondecreasing", "nonincreasing"), originCadence = c("month", "quarter", "year"),
    valuationCadence = c("month", "quarter", "year"), originAnchor = c("start", "end"), valuationAnchor = c("start", "end")
  )
  tokens <- c("id", "version", "unit", "currency", "basisId", "countPopulationId", "exposureBasisId", "compatibilityGroup", "outputMeasureId", "formulaId", "transformationRef", "rationaleArtifactId", "ageUnit", "label", "role", "measureId")
  texts <- c("displayName", "description", "sourceDescription", "displayUnit", "numeratorLabel", "denominatorLabel", "code", "message")
  for (name in c("measures", "countPopulations", "exposureBases", "amountBases", "derivedMeasures", "formulas", "instances", "reviewRules")) {
    catalog <- definition[[name]]
    if (!is.list(catalog) || (!is.null(names(catalog)) && length(catalog) > 0L)) stop(sprintf("diagnostic catalog must be an array at $.definition.%s", name))
    ids <- vapply(catalog, function(item) {
      if (!is.list(item)) stop("diagnostic catalog entry must be an object")
      ats_diag_token(item$id, paste0("$.definition.", name, ".id")); item$id
    }, character(1))
    if (anyDuplicated(ids)) stop(sprintf("duplicate diagnostic catalog ID at $.definition.%s", name))
  }
  stack <- ats_diag_stack(list(value = definition, path = "$.definition", depth = 1L))
  nodes <- 0L
  expression_nodes <- 0L
  while (!stack$empty()) {
    entry <- stack$pop()
    item <- entry$value; path <- entry$path
    nodes <- nodes + 1L
    if (entry$depth > 256L || nodes > 1000000L) stop(sprintf("diagnostic JSON resource limit at %s", path))
    if (is.null(item)) next
    if (is.character(item)) {
      if (length(item) != 1L || is.na(item) || !validUTF8(item)) stop(sprintf("invalid diagnostic Unicode at %s", path))
      next
    }
    if (is.numeric(item)) { ats_diag_number(item, path); next }
    if (is.logical(item) && length(item) == 1L && !is.na(item)) next
    if (!is.list(item)) stop(sprintf("non-JSON diagnostic value at %s", path))
    if (is.null(names(item))) {
      for (index in seq_along(item)) stack$push(list(value = item[[index]], path = sprintf("%s[%d]", path, index - 1L), depth = entry$depth + 1L))
      next
    }
    registry <- any(vapply(c(".attributes", ".roles", ".bindings"), function(suffix) endsWith(path, suffix), logical(1)))
    if (!registry && (!is.null(item[["op"]]) || (!is.null(item[["source"]]) && item[["source"]] %in% c("measure", "calculation", "constant")))) {
      expression_nodes <- expression_nodes + 1L
      if (expression_nodes > 100000L) stop("diagnostic definition expression node count exceeds 100000")
    }
    for (key in names(item)) {
      value <- item[[key]]; current <- paste0(path, ".", key)
      ats_diag_token(key, path)
      if (identical(key, "attributes")) {
        if (!is.list(value) || any(vapply(value, function(v) !is.null(v) && (is.list(v) || length(v) != 1L), logical(1)))) stop(sprintf("diagnostic attributes must contain JSON scalars at %s", current))
        for (attribute in names(value)) ats_diag_token(attribute, current)
      } else if (!any(vapply(c(".attributes", ".roles", ".bindings"), function(suffix) endsWith(path, suffix), logical(1)))) {
        nullable_enum <- identical(key, "exposureTiming") || (identical(key, "developmentSemantics") && grepl("\\.roles\\.", path))
        if (key %in% names(enums) && (!is.null(value) || !nullable_enum)) ats_diag_enum(value, enums[[key]], current)
        if (key %in% tokens && (!is.null(value) || !(key %in% c("basisId", "countPopulationId", "exposureBasisId", "compatibilityGroup")))) ats_diag_token(value, current)
        nullable_text <- identical(key, "sourceDescription") || (identical(key, "description") && endsWith(path, ".limitation"))
        if (key %in% texts && !(is.null(value) && nullable_text) && (!is.character(value) || length(value) != 1L)) stop(sprintf("diagnostic text must be a string at %s", current))
        if (!is.null(value) && key %in% c("ageOffset", "coordinate", "minDevelopmentAge", "maxDevelopmentAge")) ats_diag_number(value, current, integer = TRUE, nonnegative = !(key %in% c("ageOffset", "coordinate")))
        if (!is.null(value) && key %in% c("attachment", "limit", "scale")) ats_diag_number(value, current, nonnegative = TRUE)
        if (key %in% c("roles", "bindings")) {
          if (!is.list(value) || is.null(names(value))) stop(sprintf("diagnostic role registry must be an object at %s", current))
          for (role in names(value)) ats_diag_token(role, current)
        }
      }
      stack$push(list(value = value, path = current, depth = entry$depth + 1L))
    }
    if (!is.null(item$aggregation)) {
      ats_diag_enum(item$source, c("loss", "exposure", "derived"), paste0(path, ".source"))
      ats_diag_enum(item$kind, c("count", "amount", "exposure"), paste0(path, ".kind"))
    }
    if (grepl("\\.roles\\.", path) && !is.null(item$kind)) ats_diag_enum(item$kind, c("count", "amount", "exposure"), paste0(path, ".kind"))
    if (endsWith(path, ".derivation")) ats_diag_enum(item$kind, c("sdk", "external"), paste0(path, ".kind"))
    if (endsWith(path, ".comparability")) ats_diag_enum(item$kind, c("compiler-proven", "caller-asserted"), paste0(path, ".kind"))
    if (endsWith(path, ".projection")) ats_diag_enum(item$kind, c("valuation", "latest-valuation-per-origin", "all-cells"), paste0(path, ".kind"))
  }
  if (identical(definition$periodAxis$kind, "calendar")) ats_diag_enum(definition$periodAxis$ageUnit, "month", "$.definition.periodAxis.ageUnit")
  invisible(TRUE)
}

ats_validate_diag_expression <- function(root, reference, path, wrapper = FALSE) {
  stack <- ats_diag_stack(list(value = root, path = path, depth = if (wrapper) 2L else 1L))
  nodes <- if (wrapper) 1L else 0L
  while (!stack$empty()) {
    entry <- stack$pop()
    if (entry$depth > 64L) stop(sprintf("diagnostic expression depth exceeds 64 at %s", entry$path))
    nodes <- nodes + 1L
    if (nodes > 10000L) stop(sprintf("diagnostic expression node count exceeds 10000 at %s", path))
    expression <- entry$value
    if (!is.list(expression)) stop(sprintf("diagnostic expression must be an object at %s", entry$path))
    op <- expression$op
    if (identical(op, reference) || (identical(reference, "claim") && identical(op, "measure"))) {
      key <- if (identical(reference, "role")) "role" else "measureId"
      ats_diag_exact(expression, c("op", key), entry$path)
      ats_diag_token(expression[[key]], paste0(entry$path, ".", key))
    } else if (identical(reference, "claim") && identical(op, "claim-layer")) {
      ats_diag_exact(expression, c("op", "measureId", "attachment", "limit"), entry$path)
      ats_diag_token(expression$measureId, paste0(entry$path, ".measureId"))
      ats_diag_number(expression$attachment, paste0(entry$path, ".attachment"), nonnegative = TRUE)
      if (!is.null(expression$limit)) ats_diag_number(expression$limit, paste0(entry$path, ".limit"), nonnegative = TRUE)
    } else if (identical(op, "add")) {
      ats_diag_exact(expression, c("op", "terms"), entry$path)
      if (length(expression$terms) == 0L) stop(sprintf("diagnostic add terms must be nonempty at %s", entry$path))
      for (index in seq_along(expression$terms)) stack$push(list(value = expression$terms[[index]], path = sprintf("%s.terms[%d]", entry$path, index - 1L), depth = entry$depth + 1L))
    } else if (identical(op, "subtract")) {
      ats_diag_exact(expression, c("op", "left", "right"), entry$path)
      stack$push(list(value = expression$left, path = paste0(entry$path, ".left"), depth = entry$depth + 1L))
      stack$push(list(value = expression$right, path = paste0(entry$path, ".right"), depth = entry$depth + 1L))
    } else stop(sprintf("unknown diagnostic expression operator '%s' at %s", op, entry$path))
  }
}

ats_validate_diag_tolerance <- function(value, path) {
  ats_diag_exact(value, c("absolute", "relative"), path)
  for (key in names(value)) ats_diag_number(value[[key]], paste0(path, ".", key), nonnegative = TRUE)
}

ats_validate_review_operand <- function(value, path) {
  if (identical(value$op, "constant")) {
    ats_diag_exact(value, c("op", "value"), path)
    ats_diag_number(value$value, paste0(path, ".value"))
  }
  else ats_validate_diag_expression(value, "measure", path)
}

ats_validate_metric_operand <- function(value, path) {
  if (identical(value$source, "measure")) {
    ats_diag_exact(value, c("source", "expression"), path)
    ats_validate_diag_expression(value$expression, "measure", paste0(path, ".expression"), wrapper = TRUE)
  } else if (identical(value$source, "calculation")) {
    ats_diag_exact(value, c("source", "field"), path)
    ats_diag_enum(value$field, c("numerator", "denominator"), paste0(path, ".field"))
  } else if (identical(value$source, "constant")) {
    ats_diag_exact(value, c("source", "value"), path)
    ats_diag_number(value$value, paste0(path, ".value"))
  } else stop(sprintf("unknown diagnostic rule operand source '%s' at %s", value$source, path))
}

ats_validate_closed_diagnostic_definition <- function(definition) {
  ats_validate_diag_scalars(definition)
  ats_diag_exact(definition, c("diagnosticDefinitionVersion", "id", "version", "lossRowGrain", "measures", "countPopulations", "exposureBases", "amountBases", "derivedMeasures", "formulas", "instances", "reviewRules", "periodAxis"), "$.definition")
  for (index in seq_along(definition$measures)) ats_diag_exact(definition$measures[[index]], c("id", "displayName", "description", "source", "kind", "unit", "developmentSemantics", "aggregation", "missing", "basisId", "countPopulationId", "exposureBasisId", "exposureTiming"), sprintf("$.definition.measures[%d]", index - 1L))
  for (index in seq_along(definition$countPopulations)) ats_diag_exact(definition$countPopulations[[index]], c("id", "displayName", "subject", "unit", "description", "attributes"), sprintf("$.definition.countPopulations[%d]", index - 1L))
  for (index in seq_along(definition$exposureBases)) ats_diag_exact(definition$exposureBases[[index]], c("id", "displayName", "basis", "unit", "description", "sourceDescription", "attributes"), sprintf("$.definition.exposureBases[%d]", index - 1L))
  for (index in seq_along(definition$amountBases)) {
    basis <- definition$amountBases[[index]]
    path <- sprintf("$.definition.amountBases[%d]", index - 1L)
    ats_diag_exact(basis, c("id", "displayName", "currency", "perspective", "components", "sourceDescription", "attributes"), path)
    for (component_index in seq_along(basis$components)) {
      component <- basis$components[[component_index]]
      component_path <- sprintf("%s.components[%d]", path, component_index - 1L)
      ats_diag_exact(component, c("id", "treatment", "limitation"), component_path)
      limitation <- component$limitation
      if (identical(limitation$kind, "unlimited")) ats_diag_exact(limitation, "kind", paste0(component_path, ".limitation"))
      else if (identical(limitation$kind, "unknown")) ats_diag_exact(limitation, c("kind", "description"), paste0(component_path, ".limitation"))
      else if (limitation$kind %in% c("layer", "pre-limited")) {
        ats_diag_exact(limitation, c("kind", "attachment", "limit", "application", "derivation"), paste0(component_path, ".limitation"))
        derivation <- limitation$derivation
        ats_diag_exact(derivation, if (identical(derivation$kind, "sdk")) "kind" else c("kind", "actor", "transformationRef"), paste0(component_path, ".limitation.derivation"))
      } else stop(sprintf("unknown amount limitation kind '%s' at %s.limitation", limitation$kind, component_path))
    }
  }
  for (index in seq_along(definition$derivedMeasures)) {
    item <- definition$derivedMeasures[[index]]
    ats_diag_exact(item, c("id", "outputMeasureId", "expression"), sprintf("$.definition.derivedMeasures[%d]", index - 1L))
    ats_validate_diag_expression(item$expression, "claim", sprintf("$.definition.derivedMeasures[%d].expression", index - 1L))
  }
  for (index in seq_along(definition$formulas)) {
    item <- definition$formulas[[index]]
    path <- sprintf("$.definition.formulas[%d]", index - 1L)
    ats_diag_exact(item, c("id", "version", "roles", "numerator", "denominator", "denominatorPolicy"), path)
    for (role in names(item$roles)) ats_diag_exact(item$roles[[role]], c("kind", "compatibilityGroup", "developmentSemantics"), paste0(path, ".roles.", role))
    ats_validate_diag_expression(item$numerator, "role", paste0(path, ".numerator"))
    ats_validate_diag_expression(item$denominator, "role", paste0(path, ".denominator"))
  }
  for (index in seq_along(definition$instances)) {
    item <- definition$instances[[index]]
    path <- sprintf("$.definition.instances[%d]", index - 1L)
    ats_diag_exact(item, c("id", "version", "formulaId", "bindings", "presentation", "rules"), path)
    for (role in names(item$bindings)) ats_validate_diag_expression(item$bindings[[role]], "measure", paste0(path, ".bindings.", role))
    ats_diag_exact(item$presentation, c("displayName", "description", "displayUnit", "scale", "numeratorLabel", "denominatorLabel"), paste0(path, ".presentation"))
    for (rule_index in seq_along(item$rules)) {
      rule <- item$rules[[rule_index]]
      rule_path <- sprintf("%s.rules[%d]", path, rule_index - 1L)
      ats_diag_exact(rule, c("id", "code", "message", "severity", "when"), rule_path)
      ats_diag_exact(rule$when, c("left", "operator", "right", "tolerance"), paste0(rule_path, ".when"))
      ats_validate_metric_operand(rule$when$left, paste0(rule_path, ".when.left"))
      ats_validate_metric_operand(rule$when$right, paste0(rule_path, ".when.right"))
      if (!is.null(rule$when$tolerance)) ats_validate_diag_tolerance(rule$when$tolerance, paste0(rule_path, ".when.tolerance"))
    }
  }
  common_rule_fields <- c("kind", "id", "code", "description", "severity", "tolerance", "missingInput")
  variant_fields <- list(compare = "when", reconcile = c("actual", "expected"), monotonic = c("expression", "direction"), `layer-order` = c("narrower", "broader", "comparability"), `control-total` = c("expression", "expected", "filter", "projection"))
  for (index in seq_along(definition$reviewRules)) {
    rule <- definition$reviewRules[[index]]
    path <- sprintf("$.definition.reviewRules[%d]", index - 1L)
    if (is.null(variant_fields[[rule$kind]])) stop(sprintf("unknown diagnostic review-rule kind '%s'", rule$kind))
    ats_diag_exact(rule, c(common_rule_fields, variant_fields[[rule$kind]]), path)
    if (!is.null(rule$tolerance)) ats_validate_diag_tolerance(rule$tolerance, paste0(path, ".tolerance"))
    if (identical(rule$kind, "compare")) {
      ats_diag_exact(rule$when, c("left", "operator", "right"), paste0(path, ".when"))
      ats_validate_review_operand(rule$when$left, paste0(path, ".when.left"))
      ats_validate_review_operand(rule$when$right, paste0(path, ".when.right"))
    } else if (identical(rule$kind, "reconcile")) {
      ats_validate_diag_expression(rule$actual, "measure", paste0(path, ".actual"))
      ats_validate_review_operand(rule$expected, paste0(path, ".expected"))
    } else if (identical(rule$kind, "monotonic")) ats_validate_diag_expression(rule$expression, "measure", paste0(path, ".expression"))
    else if (identical(rule$kind, "layer-order")) {
      ats_validate_diag_expression(rule$narrower, "measure", paste0(path, ".narrower"))
      ats_validate_diag_expression(rule$broader, "measure", paste0(path, ".broader"))
      ats_diag_exact(rule$comparability, if (identical(rule$comparability$kind, "compiler-proven")) "kind" else c("kind", "rationaleArtifactId"), paste0(path, ".comparability"))
    } else {
      ats_validate_diag_expression(rule$expression, "measure", paste0(path, ".expression"))
      if (!is.null(rule$filter)) ats_diag_exact(rule$filter, c("sourceGroups", "origins", "originFrom", "originThrough", "valuations", "valuationFrom", "valuationThrough", "minDevelopmentAge", "maxDevelopmentAge"), paste0(path, ".filter"))
      ats_diag_exact(rule$projection, if (identical(rule$projection$kind, "valuation")) c("kind", "valuation") else "kind", paste0(path, ".projection"))
    }
  }
  axis <- definition$periodAxis
  if (identical(axis$kind, "calendar")) ats_diag_exact(axis, c("kind", "originCadence", "valuationCadence", "originAnchor", "valuationAnchor", "ageUnit", "ageOffset"), "$.definition.periodAxis")
  else if (identical(axis$kind, "ordered")) {
    ats_diag_exact(axis, c("kind", "id", "version", "ageUnit", "ageOffset", "origins", "valuations"), "$.definition.periodAxis")
    for (name in c("origins", "valuations")) for (index in seq_along(axis[[name]])) ats_diag_exact(axis[[name]][[index]], c("label", "aliases", "coordinate"), sprintf("$.definition.periodAxis.%s[%d]", name, index - 1L))
  } else stop(sprintf("unknown diagnostic period-axis kind '%s'", axis$kind))
  ats_validate_diag_references(definition)
  invisible(TRUE)
}

ats_validate_diag_references <- function(definition) {
  measures <- setNames(definition$measures, vapply(definition$measures, `[[`, character(1), "id"))
  formulas <- setNames(definition$formulas, vapply(definition$formulas, `[[`, character(1), "id"))
  catalogs <- list(amount = list(field = "basisId", values = definition$amountBases),
    count = list(field = "countPopulationId", values = definition$countPopulations),
    exposure = list(field = "exposureBasisId", values = definition$exposureBases))
  signatures <- lapply(measures, function(item) {
    catalog <- catalogs[[item$kind]]
    ids <- vapply(catalog$values, `[[`, character(1), "id")
    if (is.null(item[[catalog$field]]) || !(item[[catalog$field]] %in% ids)) stop("unknown diagnostic semantic reference")
    ats_select_fields(item, c("kind", "unit", "basisId", "countPopulationId", "exposureBasisId"))
  })
  signature <- function(expression, registry, reference) {
    if (identical(expression$op, "constant")) return(NULL)
    if (expression$op %in% c(reference, "claim-layer")) {
      key <- if (identical(reference, "role")) expression$role else expression$measureId
      if (!(key %in% names(registry))) stop("unknown diagnostic expression reference")
      return(registry[[key]])
    }
    children <- if (identical(expression$op, "add")) expression$terms else list(expression$left, expression$right)
    quantities <- lapply(children, signature, registry = registry, reference = reference)
    if (!all(vapply(quantities, identical, logical(1), quantities[[1]]))) stop("incompatible diagnostic expression quantities")
    quantities[[1]]
  }
  compatible <- function(left, right) {
    if (!is.null(left) && !is.null(right) && !identical(left, right)) stop("incompatible diagnostic comparison quantities")
  }
  for (derivation in definition$derivedMeasures) {
    if (!(derivation$outputMeasureId %in% names(measures))) stop("unknown derived diagnostic output measure")
    # Claim derivations may construct a new amount basis from disjoint components.
    if (!all(ats_diag_dependencies(derivation$expression) %in% names(measures))) stop("unknown derived diagnostic input measure")
  }
  for (instance in definition$instances) {
    if (!(instance$formulaId %in% names(formulas))) stop("unknown diagnostic formula")
    formula <- formulas[[instance$formulaId]]
    if (!setequal(names(instance$bindings), names(formula$roles))) stop("diagnostic bindings must match formula roles")
    roles <- lapply(instance$bindings, signature, registry = signatures, reference = "measure")
    groups <- list()
    for (role in names(roles)) {
      contract <- formula$roles[[role]]; quantity <- roles[[role]]
      if (!identical(quantity$kind, contract$kind)) stop("incompatible diagnostic formula role kind")
      group <- contract$compatibilityGroup
      if (!is.null(group)) {
        if (group %in% names(groups)) compatible(groups[[group]], quantity)
        groups[group] <- list(quantity)
      }
    }
    calculations <- lapply(formula[c("numerator", "denominator")], signature, registry = roles, reference = "role")
    for (rule in instance$rules) {
      metric_operand <- function(value) {
        if (identical(value$source, "constant")) return(NULL)
        if (identical(value$source, "calculation")) return(calculations[[value$field]])
        signature(value$expression, signatures, "measure")
      }
      compatible(metric_operand(rule$when$left), metric_operand(rule$when$right))
    }
  }
  for (rule in definition$reviewRules) {
    if (identical(rule$kind, "compare")) compatible(signature(rule$when$left, signatures, "measure"), signature(rule$when$right, signatures, "measure"))
    else if (identical(rule$kind, "reconcile")) compatible(signature(rule$actual, signatures, "measure"), signature(rule$expected, signatures, "measure"))
    else if (identical(rule$kind, "layer-order")) {
      narrower <- signature(rule$narrower, signatures, "measure"); broader <- signature(rule$broader, signatures, "measure")
      if (!identical(narrower[c("kind", "unit")], broader[c("kind", "unit")]) || !identical(narrower$kind, "amount")) stop("incompatible diagnostic layer quantities")
    } else signature(rule$expression, signatures, "measure")
  }
  invisible(TRUE)
}

ats_parse_diagnostic_definition <- function(path) {
  # jsonlite may replace an unpaired escape with a warning. Inspect escape
  # pairs before parsing so malformed UTF-16 is rejected, never repaired.
  raw <- paste(readLines(path, warn = FALSE), collapse = "\n")
  chars <- strsplit(raw, "", fixed = TRUE)[[1]]
  index <- 1L
  while (index <= length(chars)) {
    if (identical(chars[[index]], "\\") && index < length(chars)) {
      if (identical(chars[[index + 1L]], "u") && index + 5L <= length(chars)) {
        unit <- strtoi(paste(chars[(index + 2L):(index + 5L)], collapse = ""), 16L)
        if (!is.na(unit) && (unit == 0L || (unit >= 56320L && unit <= 57343L))) stop("invalid diagnostic Unicode escape")
        if (!is.na(unit) && unit >= 55296L && unit <= 56319L) {
          paired <- index + 11L <= length(chars) && identical(chars[[index + 6L]], "\\") && identical(chars[[index + 7L]], "u")
          low <- if (paired) strtoi(paste(chars[(index + 8L):(index + 11L)], collapse = ""), 16L) else NA_integer_
          if (is.na(low) || low < 56320L || low > 57343L) stop("invalid diagnostic Unicode escape")
          index <- index + 6L
        }
        index <- index + 6L
      } else index <- index + 2L
    } else index <- index + 1L
  }
  doc <- ats_read_document(path)
  if (!identical(doc$kind, "diagnostic-definition")) stop("expected diagnostic-definition")
  body <- doc$diagnosticDefinition
  if (!identical(body$definition$diagnosticDefinitionVersion, "1.0.0")) {
    stop("unsupported diagnosticDefinitionVersion")
  }
  ats_validate_closed_diagnostic_definition(body$definition)
  actual <- ats_diagnostic_identities(body$definition)
  if (!identical(ats_canonical_json(actual), ats_canonical_json(body$identities))) {
    stop("diagnostic definition identities do not match semantic definition")
  }
  body$definition
}

ats_eval_diagnostic_expression <- function(expression, values, reference) {
  op <- expression$op
  if (identical(op, reference)) {
    key <- if (identical(reference, "measure")) expression$measureId else expression$role
    return(values[[key]])
  }
  children <- if (identical(op, "add")) expression$terms else list(expression$left, expression$right)
  evaluated <- lapply(children, ats_eval_diagnostic_expression, values = values, reference = reference)
  if (any(vapply(evaluated, is.null, logical(1)))) return(NULL)
  result <- if (identical(op, "add")) ats_diag_sum(unlist(evaluated)) else evaluated[[1]] - evaluated[[2]]
  if (is.null(result) || !is.finite(result)) NULL else result
}

ats_diag_sum <- function(values) {
  total <- correction <- 0
  for (value in values) {
    next_total <- total + value
    correction <- correction + if (abs(total) >= abs(value)) total - next_total + value else value - next_total + total
    total <- next_total
    if (!is.finite(total) || !is.finite(correction)) return(NULL)
  }
  value <- total + correction
  if (is.finite(value)) value else NULL
}

ats_replay_diagnostic_cell <- function(definition, instance_id, values) {
  instance <- Filter(function(item) identical(item$id, instance_id), definition$instances)[[1]]
  formula <- Filter(function(item) identical(item$id, instance$formulaId), definition$formulas)[[1]]
  roles <- lapply(instance$bindings, ats_eval_diagnostic_expression, values = values, reference = "measure")
  numerator <- ats_eval_diagnostic_expression(formula$numerator, roles, "role")
  denominator <- ats_eval_diagnostic_expression(formula$denominator, roles, "role")
  value <- if (is.null(numerator) || is.null(denominator) || denominator <= 0) NULL else numerator / denominator
  if (!is.null(value) && !is.finite(value)) value <- NULL
  list(numerator = numerator, denominator = denominator, value = value)
}

ats_diagnostic_aggregate_cells <- function(definition, supplied) {
  axis <- definition$periodAxis
  period <- function(label, side) {
    if (identical(axis$kind, "ordered")) {
      item <- Filter(function(item) identical(label, item$label) || label %in% unlist(item$aliases), axis[[paste0(side, "s")]])[[1]]
      return(list(label = item$label, coordinate = item$coordinate))
    }
    if (!identical(axis[[paste0(side, "Cadence")]], "year")) stop("aggregate conformance replay requires annual calendar or ordered axis")
    list(label = label, coordinate = as.numeric(label) * 12 + if (identical(axis[[paste0(side, "Anchor")]], "end")) 12 else 0)
  }
  output <- list(); seen <- character()
  for (row in supplied$losses) {
    origin <- period(row$origin, "origin"); valuation <- period(row$valuation, "valuation")
    key <- ats_canonical_json(list(row$sourceGroup, origin$label, valuation$label))
    if (key %in% seen || !identical(row$rowType, "aggregate") || !isTRUE(row$complete)) stop("aggregate conformance replay needs one complete row per cell")
    seen <- c(seen, key)
    values <- row$measures
    for (exposure in supplied$exposures) {
      if (identical(exposure$sourceGroup, row$sourceGroup) && identical(period(exposure$origin, "origin")$label, origin$label) &&
          (is.null(exposure$valuation) || identical(period(exposure$valuation, "valuation")$label, valuation$label)))
        values[exposure$measureId] <- list(exposure$value)
    }
    output[[length(output) + 1L]] <- list(coordinate = list(sourceGroup = row$sourceGroup, origin = origin$label,
      valuation = valuation$label, developmentAge = valuation$coordinate - origin$coordinate + axis$ageOffset, ageUnit = axis$ageUnit), values = values)
  }
  ordering <- order(vapply(output, function(cell) ats_utf16be_sortkey(cell$coordinate$sourceGroup), character(1)),
    vapply(output, function(cell) cell$coordinate$origin, character(1)),
    vapply(output, function(cell) cell$coordinate$developmentAge, numeric(1)))
  output[ordering]
}

# A small independent oracle over the frozen aggregate corpus. It refuses
# ingestion/selection cases outside that corpus; this is not another SDK.
ats_replay_diagnostic_reviews <- function(definition, supplied) {
  cells <- ats_diagnostic_aggregate_cells(definition, supplied)
  results <- list()
  operand <- function(expression, values, path, coordinate) {
    if (identical(expression$op, "constant")) return(list(value = expression$value, reasons = list(), overflows = list()))
    if (identical(expression$op, "measure")) {
      value <- values[[expression$measureId]]
      return(list(value = value, reasons = if (is.null(value)) list("missing") else list(), overflows = list()))
    }
    parts <- if (identical(expression$op, "add")) expression$terms else list(expression$left, expression$right)
    paths <- if (identical(expression$op, "add")) sprintf("%s/terms/%d", path, seq_along(parts) - 1L) else paste0(path, c("/left", "/right"))
    children <- lapply(seq_along(parts), function(index) operand(parts[[index]], values, paths[[index]], coordinate))
    reasons <- as.list(c("missing", "expression-overflow")[c("missing", "expression-overflow") %in% unlist(lapply(children, `[[`, "reasons"))])
    overflows <- unlist(lapply(children, `[[`, "overflows"), recursive = FALSE)
    if (is.null(overflows)) overflows <- list()
    if (any(vapply(children, function(child) is.null(child$value), logical(1)))) return(list(value = NULL, reasons = reasons, overflows = overflows))
    value <- if (identical(expression$op, "add")) ats_diag_sum(vapply(children, `[[`, numeric(1), "value")) else children[[1]]$value - children[[2]]$value
    if (is.null(value) || !is.finite(value)) {
      reasons <- as.list(unique(c(unlist(reasons), "expression-overflow")))
      overflows[[length(overflows) + 1L]] <- list(expressionPath = path, sources = list(), coordinate = coordinate)
      value <- NULL
    }
    list(value = value, reasons = reasons, overflows = overflows)
  }
  record <- function(rule, left, right, scope) {
    reason_order <- c("missing", "expression-overflow")
    reasons <- as.list(reason_order[reason_order %in% c(unlist(left$reasons), unlist(right$reasons))])
    relation <- NULL
    if (length(reasons) == 0L) {
      tolerance <- rule$tolerance
      threshold <- tolerance$absolute + tolerance$relative * max(1, abs(left$value), abs(right$value))
      if (!is.finite(threshold)) reasons <- list("tolerance-overflow")
      else relation <- if (abs(left$value - right$value) <= threshold) "equal" else if (left$value < right$value) "less" else "greater"
    }
    if (length(reasons) > 0L) {
      status <- if (identical(rule$missingInput, "finding")) "triggered" else "not-evaluated"
      trigger <- if (identical(status, "triggered")) { if ("missing" %in% unlist(reasons)) "missing-input" else reasons[[1]] } else NULL
    } else {
      if (identical(rule$kind, "compare")) {
        matches <- c(lt = identical(relation, "less"), lte = !identical(relation, "greater"), eq = identical(relation, "equal"),
          neq = !identical(relation, "equal"), gte = !identical(relation, "less"), gt = identical(relation, "greater"))
        passed <- !matches[[rule$when$operator]]
      } else if (rule$kind %in% c("reconcile", "control-total")) passed <- identical(relation, "equal")
      else if (identical(rule$kind, "monotonic")) passed <- !identical(relation, if (identical(rule$direction, "nondecreasing")) "greater" else "less")
      else passed <- !identical(relation, "greater")
      status <- if (passed) "pass" else "triggered"
      trigger <- if (passed) NULL else "predicate"
    }
    overflows <- c(left$overflows, right$overflows)
    if (length(overflows) > 0L) overflows <- overflows[order(vapply(overflows, `[[`, character(1), "expressionPath"))]
    result <- list(ruleId = rule$id, ruleKind = rule$kind, severity = rule$severity, scope = scope,
      status = status, triggerReason = trigger, left = left$value, right = right$value, relation = relation,
      notEvaluatedReasons = reasons, expressionOverflows = overflows)
    if (identical(rule$kind, "layer-order")) result$comparability <- rule$comparability
    results[[length(results) + 1L]] <<- result
  }
  for (index in seq_along(definition$reviewRules)) {
    rule <- definition$reviewRules[[index]]; base <- sprintf("/reviewRules/%d", index - 1L)
    if (identical(rule$kind, "control-total")) {
      selected <- cells; selection <- rule$filter
      if (!is.null(selection)) {
        if (any(vapply(selection[setdiff(names(selection), "sourceGroups")], Negate(is.null), logical(1)))) stop("unsupported aggregate conformance selection")
        if (!is.null(selection$sourceGroups)) selected <- Filter(function(cell) cell$coordinate$sourceGroup %in% unlist(selection$sourceGroups), selected)
      }
      if (identical(rule$projection$kind, "latest-valuation-per-origin")) {
        keys <- vapply(selected, function(cell) ats_canonical_json(list(cell$coordinate$sourceGroup, cell$coordinate$origin)), character(1))
        selected <- selected[!duplicated(keys, fromLast = TRUE)]
      } else if (identical(rule$projection$kind, "valuation")) selected <- Filter(function(cell) identical(cell$coordinate$valuation, rule$projection$valuation), selected)
      ids <- ats_diag_dependencies(rule$expression)
      values <- setNames(lapply(ids, function(id) {
        if (length(selected) == 0L || any(vapply(selected, function(cell) is.null(cell$values[[id]]), logical(1)))) NULL
        else ats_diag_sum(vapply(selected, function(cell) cell$values[[id]], numeric(1)))
      }), ids)
      scope <- list(kind = "control-total", projection = rule$projection, filter = selection,
        selectedCellCount = length(selected), selectedContributionCount = length(selected) * length(ids), sources = list())
      record(rule, operand(rule$expression, values, paste0(base, "/expression"), NULL), list(value = rule$expected, reasons = list(), overflows = list()), scope)
    } else if (identical(rule$kind, "monotonic")) {
      if (length(cells) < 2L) next
      for (cell_index in seq_len(length(cells) - 1L)) {
        previous <- cells[[cell_index]]; current <- cells[[cell_index + 1L]]
        if (!identical(previous$coordinate$sourceGroup, current$coordinate$sourceGroup) || !identical(previous$coordinate$origin, current$coordinate$origin)) next
        scope <- list(kind = "valuation-pair", previous = previous$coordinate, current = current$coordinate, sources = list())
        record(rule, operand(rule$expression, previous$values, paste0(base, "/expression"), previous$coordinate),
          operand(rule$expression, current$values, paste0(base, "/expression"), current$coordinate), scope)
      }
    } else for (cell in cells) {
      if (identical(rule$kind, "compare")) { left <- rule$when$left; right <- rule$when$right; paths <- c("/when/left", "/when/right") }
      else if (identical(rule$kind, "reconcile")) { left <- rule$actual; right <- rule$expected; paths <- c("/actual", "/expected") }
      else { left <- rule$narrower; right <- rule$broader; paths <- c("/narrower", "/broader") }
      record(rule, operand(left, cell$values, paste0(base, paths[[1]]), cell$coordinate),
        operand(right, cell$values, paste0(base, paths[[2]]), cell$coordinate), list(kind = "cell", cell = cell$coordinate, sources = list()))
    }
  }
  results
}

# End of actuarialInterchange.R. Sourcing prints nothing; call ats_test_jcs().
