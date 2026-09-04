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
library_path <- path.expand(Sys.getenv("ACTUARIAL_TS_R_LIBRARY", field("library")))
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
duplicate_names <- intersect(direct_names, transitive_names)
if (length(duplicate_names) > 0L) stop(
  "R environment contract classifies packages as both direct and transitive: ",
  paste(duplicate_names, collapse = ", ")
)
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

download_exact <- function(item) {
  archive <- tempfile(fileext = ".tar.gz")
  downloaded <- tryCatch({
    isTRUE(suppressWarnings(download.file(item$currentUrl, archive, mode = "wb", quiet = TRUE)) == 0L)
  }, error = function(error) FALSE)
  if (!downloaded) download.file(item$archiveUrl, archive, mode = "wb", quiet = TRUE)
  archive
}

# Dependency metadata must come from the exact archives, not from CRAN's moving
# current-package index. This matters when the current release changes either
# its R floor or its dependency graph after the compatible version is archived.
archives <- setNames(lapply(plan, download_exact), vapply(plan, `[[`, character(1), "package"))
on.exit(unlink(unlist(archives, use.names = FALSE)), add = TRUE)
exact_available <- available
for (item in plan) {
  extraction <- tempfile("r-package-description-")
  dir.create(extraction)
  description_path <- file.path(item$package, "DESCRIPTION")
  description <- tryCatch({
    untar(archives[[item$package]], files = description_path, exdir = extraction)
    read.dcf(file.path(extraction, description_path))
  }, finally = unlink(extraction, recursive = TRUE, force = TRUE))
  archive_package <- unname(description[1L, "Package"])
  archive_version <- unname(description[1L, "Version"])
  if (!identical(archive_package, item$package) ||
      !identical(archive_version, item$version)) stop(
    "Downloaded archive identity ", archive_package, "@", archive_version,
    " does not match the contract for ", item$package, "@", item$version
  )

  record <- rep(NA_character_, ncol(exact_available))
  names(record) <- colnames(exact_available)
  shared_fields <- intersect(colnames(description), names(record))
  record[shared_fields] <- description[1L, shared_fields]
  if (item$package %in% rownames(exact_available)) {
    exact_available[item$package, ] <- record
  } else {
    exact_available <- rbind(exact_available, record)
    rownames(exact_available)[nrow(exact_available)] <- item$package
  }
}

dependency_is_available <- function(package) {
  isTRUE(requireNamespace(package, quietly = TRUE))
}

install_dependencies <- function(roots) {
  if (length(roots) == 0L) return(invisible(NULL))
  dependency_map <- tools::package_dependencies(roots, db = exact_available, recursive = TRUE)
  dependencies <- sort(unique(setdiff(unlist(dependency_map, use.names = FALSE), all_pinned_names)))
  dependencies <- intersect(dependencies, rownames(exact_available))
  missing <- dependencies[!vapply(dependencies, dependency_is_available, logical(1))]
  if (length(missing) > 0L) install.packages(missing, lib = library_path, repos = repository, dependencies = NA)

  unresolved <- dependencies[!vapply(dependencies, dependency_is_available, logical(1))]
  if (length(unresolved) > 0L) stop(
    "Failed to install dependencies into the contract library: ",
    paste(unresolved, collapse = ", ")
  )
}

install_exact <- function(items) for (item in items) {
  install.packages(archives[[item$package]], lib = library_path, repos = NULL, type = "source")
  installed <- installed.packages(lib.loc = library_path, noCache = TRUE)
  actual <- if (item$package %in% rownames(installed)) installed[item$package, "Version"] else NA_character_
  if (!identical(actual, item$version)) stop(
    "Failed to install exact ", item$package, " version ", item$version,
    " into the contract library; got ", actual
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
