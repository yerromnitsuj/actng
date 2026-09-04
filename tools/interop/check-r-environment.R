args <- commandArgs(trailingOnly = TRUE)
index <- match("--contract", args)
contract_path <- if (is.na(index)) "tools/interop/r-environment.json" else args[[index + 1L]]
contract_text <- paste(readLines(contract_path, warn = FALSE), collapse = "\n")
library_value <- sub('.*"library"\\s*:\\s*"([^"]+)".*', '\\1', contract_text)
if (identical(library_value, contract_text)) stop("R environment contract has no library field")
.libPaths(c(path.expand(library_value), .libPaths()))
contract <- jsonlite::fromJSON(contract_path, simplifyVector = FALSE)
actual_r <- paste(R.version$major, R.version$minor, sep = ".")
if (!identical(actual_r, contract$rVersion)) stop(
  "R runtime mismatch: expected ", contract$rVersion, ", got ", actual_r,
  ". Point ACTUARIAL_TS_RSCRIPT at the exact required Rscript executable."
)
for (name in names(contract$packages)) {
  expected <- contract$packages[[name]]
  actual <- tryCatch(as.character(packageVersion(name)), error = function(error) NA_character_)
  if (!identical(actual, expected)) stop(
    name, " mismatch: expected ", expected, ", got ", actual,
    ". Run install-r-environment.R with this contract."
  )
}
cat("R environment matches", contract_path, "\n")
