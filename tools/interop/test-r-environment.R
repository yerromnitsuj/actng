contract_path <- "tools/interop/r-environment.json"
.libPaths(c(path.expand("~/.R-interop-lib"), .libPaths()))
contract <- jsonlite::fromJSON(contract_path, simplifyVector = FALSE)
stopifnot(identical(contract$rVersion, "4.4.3"))
stopifnot(identical(contract$packages$ChainLadder, "0.2.21"))
stopifnot(identical(contract$packages$jsonlite, "2.0.0"))
rscript <- file.path(R.home("bin"), "Rscript")

scratch <- tempfile("r environment contract ")
dir.create(scratch, recursive = TRUE)
on.exit(unlink(scratch, recursive = TRUE, force = TRUE), add = TRUE)
temporary_contract <- file.path(scratch, "contract with spaces.json")
temporary_library <- file.path(scratch, "library must remain absent")
mutated <- contract
mutated$library <- temporary_library
jsonlite::write_json(mutated, temporary_contract, auto_unbox = TRUE, pretty = TRUE)
canonical_before <- readBin(contract_path, "raw", file.info(contract_path)$size)

plan_output <- system2(rscript, c("tools/interop/install-r-environment.R", "--contract", shQuote(temporary_contract), "--dry-run"), stdout = TRUE, stderr = TRUE, env = paste0("R_LIBS_USER=", shQuote(path.expand("~/.R-interop-lib"))))
if (!identical(attr(plan_output, "status"), NULL)) stop(paste(plan_output, collapse = "\n"))
plan <- jsonlite::fromJSON(paste(plan_output, collapse = "\n"), simplifyVector = FALSE)
stopifnot(length(plan) == length(contract$packages))
stopifnot(identical(plan[[1L]]$version, contract$packages$ChainLadder))
stopifnot(identical(plan[[2L]]$version, contract$packages$jsonlite))
stopifnot(!dir.exists(temporary_library))
stopifnot(identical(canonical_before, readBin(contract_path, "raw", file.info(contract_path)$size)))

wrong_runtime <- mutated
wrong_runtime$rVersion <- "0.0.0"
jsonlite::write_json(wrong_runtime, temporary_contract, auto_unbox = TRUE, pretty = TRUE)
check_output <- suppressWarnings(system2(rscript, c("tools/interop/check-r-environment.R", "--contract", shQuote(temporary_contract)), stdout = TRUE, stderr = TRUE, env = paste0("R_LIBS_USER=", shQuote(path.expand("~/.R-interop-lib")))))
stopifnot(identical(attr(check_output, "status"), 1L))
stopifnot(any(grepl("R runtime mismatch", check_output, fixed = TRUE)))
stopifnot(!dir.exists(temporary_library))

for (script in c("tools/interop/install-r-environment.R", "tools/interop/check-r-environment.R")) {
  text <- paste(readLines(script, warn = FALSE), collapse = "\n")
  stopifnot(!grepl("0\\.2\\.21|2\\.0\\.0|4\\.4\\.3", text))
}
cat("R environment contract tests passed\n")
