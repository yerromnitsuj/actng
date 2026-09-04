args <- commandArgs(trailingOnly = TRUE)
value_after <- function(flag, default) {
  index <- match(flag, args)
  if (is.na(index)) return(default)
  if (index == length(args)) stop(flag, " requires a value")
  args[[index + 1L]]
}
contract_path <- value_after("--contract", "tools/interop/r-environment.json")
dry_run <- "--dry-run" %in% args
contract_text <- paste(readLines(contract_path, warn = FALSE), collapse = "\n")
field <- function(name) {
  pattern <- paste0('.*"', name, '"\\s*:\\s*"([^"]+)".*')
  value <- sub(pattern, "\\1", contract_text)
  if (identical(value, contract_text)) stop("R environment contract has no ", name, " field")
  value
}
library_path <- path.expand(field("library"))
repository <- field("repository")

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  if (dry_run) stop("jsonlite is required to parse the R environment contract in --dry-run mode")
  dir.create(library_path, recursive = TRUE, showWarnings = FALSE)
  install.packages("jsonlite", lib = library_path, repos = repository, dependencies = NA)
  .libPaths(c(library_path, .libPaths()))
}
contract <- jsonlite::fromJSON(contract_path, simplifyVector = FALSE)
direct_names <- names(contract$packages)
direct_versions <- unlist(contract$packages, use.names = FALSE)
plan <- Map(function(name, version) list(
  package = name,
  version = version,
  currentUrl = sprintf("%s/src/contrib/%s_%s.tar.gz", contract$repository, name, version),
  archiveUrl = sprintf("%s/src/contrib/Archive/%s/%s_%s.tar.gz", contract$repository, name, name, version)
), direct_names, direct_versions)
if (dry_run) {
  cat(jsonlite::toJSON(plan, auto_unbox = TRUE, pretty = TRUE), "\n")
  quit(status = 0L)
}

dir.create(library_path, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(library_path, .libPaths()))
available <- available.packages(repos = repository, type = "source")
dependency_map <- tools::package_dependencies(direct_names, db = available, recursive = TRUE)
dependencies <- sort(unique(setdiff(unlist(dependency_map, use.names = FALSE), direct_names)))
if (length(dependencies) > 0L) install.packages(dependencies, lib = library_path, repos = repository, dependencies = NA)

for (item in plan) {
  archive <- tempfile(fileext = ".tar.gz")
  downloaded <- tryCatch({
    identical(suppressWarnings(download.file(item$currentUrl, archive, mode = "wb", quiet = TRUE)), 0L)
  }, error = function(error) FALSE)
  if (!downloaded) download.file(item$archiveUrl, archive, mode = "wb", quiet = TRUE)
  tryCatch(
    install.packages(archive, lib = library_path, repos = NULL, type = "source"),
    finally = unlink(archive)
  )
}
