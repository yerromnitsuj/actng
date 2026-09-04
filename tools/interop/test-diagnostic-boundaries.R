# Shared portable boundary vectors. Called by conformance.R and directly.
if (!exists("ats_validate_closed_diagnostic_definition")) source("tools/interop/actuarialInterchange.R")

boundary_dir <- "interop/conformance/fixtures/diagnostics"
boundary_vectors <- jsonlite::fromJSON(file.path(boundary_dir, "hostile-boundaries.json"), simplifyVector = FALSE)
boundary_doc <- jsonlite::fromJSON(file.path(boundary_dir, "generalized-casualty/calendar-definition.json"), simplifyVector = FALSE)

opaque <- boundary_doc
opaque[[boundary_vectors$opaqueEnvelope$field]] <- boundary_vectors$opaqueEnvelope$value
temporary <- tempfile(fileext = ".json")
ats_write_document(opaque, temporary)
invisible(ats_parse_diagnostic_definition(temporary))
if (!identical(ats_read_document(temporary)[[boundary_vectors$opaqueEnvelope$field]], boundary_vectors$opaqueEnvelope$value)) stop("opaque diagnostic envelope extension was lost")
unlink(temporary)

replace_path <- function(value, path, replacement) {
  key <- path[[1]]
  if (is.numeric(key)) key <- key + 1L
  if (length(path) == 1L) value[key] <- list(replacement)
  else value[key] <- list(replace_path(value[[key]], path[-1], replacement))
  value
}

for (vector in boundary_vectors$mutations) {
  candidate <- boundary_doc
  candidate$diagnosticDefinition$definition <- replace_path(candidate$diagnosticDefinition$definition, vector$path, vector$value)
  identities <- tryCatch(ats_diagnostic_identities(candidate$diagnosticDefinition$definition), error = function(error) NULL)
  if (!is.null(identities)) candidate$diagnosticDefinition$identities <- identities
  temporary <- tempfile(fileext = ".json")
  ats_write_document(candidate, temporary)
  result <- tryCatch({ ats_parse_diagnostic_definition(temporary); TRUE }, error = function(error) FALSE)
  unlink(temporary)
  if (!identical(result, vector$accept)) stop(sprintf("shared R hostile vector failed: %s", vector$id))
}

for (vector in boundary_vectors$escapedStrings) {
  candidate <- boundary_doc
  if (isTRUE(vector$accept)) {
    candidate$diagnosticDefinition$definition$id <- jsonlite::fromJSON(vector$json)
    candidate$diagnosticDefinition$identities <- ats_diagnostic_identities(candidate$diagnosticDefinition$definition)
  } else candidate$diagnosticDefinition$definition$id <- "ESCAPED_TOKEN_PLACEHOLDER"
  candidate$integrity <- ats_integrity(candidate$diagnosticDefinition)
  raw <- ats_canonical_json(candidate)
  if (!isTRUE(vector$accept)) raw <- sub('"ESCAPED_TOKEN_PLACEHOLDER"', vector$json, raw, fixed = TRUE)
  temporary <- tempfile(fileext = ".json")
  writeLines(raw, temporary)
  result <- tryCatch({ ats_parse_diagnostic_definition(temporary); TRUE }, error = function(error) {
    if (!grepl("Unicode", conditionMessage(error), fixed = TRUE)) stop(error)
    FALSE
  })
  unlink(temporary)
  if (!identical(result, vector$accept)) stop(sprintf("shared R escaped-string vector failed: %s", vector$id))
}

resource_definition <- function(vector, root) {
  definition <- boundary_doc$diagnosticDefinition$definition
  definition$formulas <- list(definition$formulas[[1]])
  instance <- definition$instances[[1]]
  instance$id <- "resource-metric"; instance$formulaId <- "amount-per-claim"
  instance$bindings <- list(amount = list(op = "measure", measureId = "gross-paid"), claims = list(op = "measure", measureId = "reported"))
  instance$rules <- list()
  definition$instances <- list(instance); definition$reviewRules <- list(); definition$derivedMeasures <- list()
  expression <- function(size, reference = "measure", name = "gross-paid") {
    leaf <- list(op = reference)
    leaf[[if (identical(reference, "role")) "role" else "measureId"]] <- name
    if (identical(vector$dimension, "depth")) {
      if (size > 1L) for (index in seq_len(size - 1L)) leaf <- list(op = "add", terms = list(leaf))
      leaf
    } else if (size == 1L) leaf else list(op = "add", terms = replicate(size - 1L, leaf, simplify = FALSE))
  }
  if (identical(vector$dimension, "definition")) {
    definition$instances <- lapply(0:9, function(index) {
      item <- instance; item$id <- sprintf("resource-metric-%d", index)
      item$bindings$amount <- expression(if (index < 9L) 9999L else vector$size - 90003L)
      item
    })
  } else if (startsWith(root, "formula-")) {
    field <- sub("formula-", "", root, fixed = TRUE)
    definition$formulas[[1]][[field]] <- expression(vector$size, "role", if (identical(field, "numerator")) "amount" else "claims")
  } else if (identical(root, "instance-binding")) definition$instances[[1]]$bindings$amount <- expression(vector$size)
  else if (identical(root, "claim-derivation")) {
    definition$lossRowGrain <- "claim"
    measure <- Filter(function(item) identical(item$id, "reported"), definition$measures)[[1]]
    measure$id <- "derived-probe"; measure$source <- "derived"
    definition$measures[[length(definition$measures) + 1L]] <- measure
    definition$derivedMeasures <- list(list(id = "probe", outputMeasureId = "derived-probe", expression = expression(vector$size, name = "reported")))
  } else if (identical(root, "review-rule")) definition$reviewRules <- list(list(id = "probe", kind = "reconcile", code = "probe", description = "probe", severity = "warning", missingInput = "not-evaluated", tolerance = list(absolute = 0, relative = 0), actual = expression(vector$size), expected = list(op = "constant", value = 0)))
  else definition$instances[[1]]$rules <- list(list(id = "probe", code = "probe", message = "probe", severity = "warning", when = list(left = list(source = "measure", expression = expression(vector$size - 1L)), operator = "gt", right = list(source = "constant", value = 0), tolerance = list(absolute = 0, relative = 0))))
  definition
}

for (vector in boundary_vectors$resources) {
  roots <- if (identical(vector$dimension, "definition")) list("definition") else boundary_vectors$expressionRoots
  for (root in roots) {
    candidate <- resource_definition(vector, root)
    result <- tryCatch({ ats_validate_closed_diagnostic_definition(candidate); TRUE }, error = function(error) {
      if (!grepl("exceeds|resource limit", conditionMessage(error))) stop(error)
      FALSE
    })
    if (!identical(result, vector$accept)) stop(sprintf("shared R resource vector failed: %s/%s", vector$id, root))
  }
}
cat("diagnostic boundaries: shared hostile strings, semantic mutations, and exact expression/definition budgets PASS.\n")
