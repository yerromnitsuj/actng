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
transitive_names <- names(contract$transitivePackages)
make_plan <- function(packages, classification) Map(function(name, version) list(
  package = name,
  version = version,
  classification = classification,
  currentUrl = sprintf("%s/src/contrib/%s_%s.tar.gz", contract$repository, name, version),
  archiveUrl = sprintf("%s/src/contrib/Archive/%s/%s_%s.tar.gz", contract$repository, name, name, version)
), names(packages), unlist(packages, use.names = FALSE))
transitive_plan <- make_plan(contract$transitivePackages, "transitive")
direct_plan <- make_plan(contract$packages, "direct")
plan <- c(transitive_plan, direct_plan)
if (dry_run) {
  cat(jsonlite::toJSON(plan, auto_unbox = TRUE, pretty = TRUE), "\n")
  quit(status = 0L)
}

dir.create(library_path, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(library_path, .libPaths()))
available <- available.packages(repos = repository, type = "source")
all_pinned_names <- c(transitive_names, direct_names)
install_dependencies <- function(roots) {
  if (length(roots) == 0L) return(invisible(NULL))
  dependency_map <- tools::package_dependencies(roots, db = available, recursive = TRUE)
  dependencies <- sort(unique(setdiff(unlist(dependency_map, use.names = FALSE), all_pinned_names)))
  dependencies <- intersect(dependencies, rownames(available))
  missing <- setdiff(dependencies, rownames(installed.packages()))
  if (length(missing) > 0L) install.packages(missing, lib = library_path, repos = repository, dependencies = NA)
}

install_exact <- function(items) for (item in items) {
  archive <- tempfile(fileext = ".tar.gz")
  downloaded <- tryCatch({
    isTRUE(suppressWarnings(download.file(item$currentUrl, archive, mode = "wb", quiet = TRUE)) == 0L)
  }, error = function(error) FALSE)
  if (!downloaded) download.file(item$archiveUrl, archive, mode = "wb", quiet = TRUE)
  tryCatch(
    install.packages(archive, lib = library_path, repos = NULL, type = "source"),
    finally = unlink(archive)
  )
}

# Install the archived compatibility pins before their dependants. For example,
# current CRAN Deriv requires a newer R than this contract, while current doBy
# imports Deriv. Resolving everything in one moving-head batch would therefore
# fail before the exact compatible archive could be installed.
install_dependencies(transitive_names)
install_exact(transitive_plan)
install_dependencies(direct_names)
install_exact(direct_plan)
