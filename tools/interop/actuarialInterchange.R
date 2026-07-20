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

# Local interop library (ChainLadder 0.2.21 + jsonlite 2.0.0 live here) — make
# the file self-contained so `Rscript tools/interop/actuarialInterchange.R`
# sources cleanly on its own, not only when a caller pre-sets the path.
local({
  lib <- path.expand("~/.R-interop-lib")
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

ats_selection_to_delta <- function(triangle, selection_doc, tolerance = 5e-4) {
  sel <- if (!is.null(selection_doc$selection)) selection_doc$selection else selection_doc
  dev <- sel$development
  # Selected factors, ordered by fromAgeMonths (one per development step).
  from_ages <- vapply(dev, function(d) as.numeric(d$fromAgeMonths), numeric(1))
  ord <- order(from_ages)
  selected <- vapply(dev[ord], function(d) as.numeric(d$value), numeric(1))

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
  dev <- sel$development
  from_ages <- vapply(dev, function(d) as.numeric(d$fromAgeMonths), numeric(1))
  selected <- vapply(dev[order(from_ages)], function(d) as.numeric(d$value), numeric(1))
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
                                  generator = list(name = "actuarialInterchange.R", version = "0.1.0"),
                                  extensions = NULL, governance = NULL) {
  doc <- list(
    interchangeVersion = "1.0.0",
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
    c(doc$interchange$triangles, doc$interchange$selections, doc$interchange$results)
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

# End of actuarialInterchange.R. Sourcing prints nothing; call ats_test_jcs().
