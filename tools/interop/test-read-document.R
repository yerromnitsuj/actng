# test-read-document.R — guards spec 3.5 version acceptance on documents
# embedded inside a study (Finding #2): `ats_read_document` must refuse a
# study whose embedded triangle declares a wrong-major `interchangeVersion`,
# matching the TS (`parse.ts`) and Python (`documents.py`) shores. Before the
# fix, `ats_read_document` only checked the OUTER envelope's version; a
# 2.0.0 triangle embedded in a 1.0.0 study read cleanly.
#
# Run: Rscript tools/interop/test-read-document.R

.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(fa) == 1L && nzchar(fa)) normalizePath(fa) else normalizePath("tools/interop/test-read-document.R")
})
source(file.path(dirname(.this_file), "actuarialInterchange.R"))

triangle_doc <- ats_matrix_to_triangle_doc(
  matrix(
    c(100, 150, 120, NA),
    nrow = 2, byrow = TRUE,
    dimnames = list(c("2023", "2024"), c("12", "24"))
  ),
  valuation_date = "2024-12-31"
)

study_body <- function(triangle) {
  list(
    title = "embedded-version guard fixture",
    narrative = list(summary = "s"),
    triangles = list(triangle),
    selections = list()
  )
}

wrong_major <- triangle_doc
wrong_major$interchangeVersion <- "2.0.0" # envelope field: integrity tag stays valid

tmp_bad <- tempfile(fileext = ".json")
tmp_ok <- tempfile(fileext = ".json")
ats_write_document(ats_assemble_document("study", study_body(wrong_major)), tmp_bad)
ats_write_document(ats_assemble_document("study", study_body(triangle_doc)), tmp_ok)

res <- tryCatch(ats_read_document(tmp_bad), condition = identity)
stopifnot(inherits(res, "interchange_version_error"))
stopifnot(grepl("embedded document", conditionMessage(res)))

# Control: the same study shape with the embedded document at 1.0.0 must
# still read cleanly (over-tightening would break every conforming study).
ok <- ats_read_document(tmp_ok)
stopifnot(identical(ok$kind, "study"))

unlink(c(tmp_bad, tmp_ok))

cat("test-read-document.R: embedded-version guard OK\n")
