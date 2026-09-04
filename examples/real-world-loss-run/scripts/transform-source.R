args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3) {
  stop("usage: Rscript transform-source.R INPUT_RDA COMPACT_OUTPUT_DIR FULL_OUTPUT_DIR")
}

input_path <- args[[1]]
compact_dir <- args[[2]]
full_dir <- args[[3]]
if (!file.exists(input_path)) {
  stop(sprintf("source file not found: %s (run npm run data:fetch first)", input_path))
}

source_env <- new.env(parent = emptyenv())
loaded_names <- load(input_path, envir = source_env)
if (!"freclaimset2motor" %in% loaded_names) {
  stop("source archive does not contain freclaimset2motor")
}
dataset <- source_env$freclaimset2motor
if (!is.list(dataset) || !all(c("claimset", "aggdata") %in% names(dataset))) {
  stop("freclaimset2motor must contain claimset and aggdata")
}

claims <- as.data.frame(dataset$claimset, stringsAsFactors = FALSE)
exposures <- as.data.frame(dataset$aggdata, stringsAsFactors = FALSE)
claim_columns <- c(
  "ClaimID", "OccurYear", "ManagYear", "ClaimStatus", "PaidAmount",
  "RecourseAmount", "ExpectCharge", "ExpectRecourse"
)
exposure_columns <- c("Year", "Exposure", "GWP", "ClaimNb")
if (!all(claim_columns %in% names(claims))) stop("claimset columns do not match the documented source")
if (!all(exposure_columns %in% names(exposures))) stop("aggdata columns do not match the documented source")
if (nrow(claims) != 1012839L) stop("pinned source must contain exactly 1,012,839 claim rows")
if (nrow(exposures) != 20L) stop("pinned source must contain exactly 20 exposure rows")
if (anyNA(claims[, claim_columns]) || anyNA(exposures[, exposure_columns])) {
  stop("pinned source contains unexpected missing values")
}
money_columns <- c("PaidAmount", "RecourseAmount", "ExpectCharge", "ExpectRecourse")
if (any(!is.finite(as.matrix(claims[, money_columns])))) {
  stop("pinned source contains non-finite claim amounts")
}

open_statuses <- c("on-going", "partially closed", "reopened")
closed_statuses <- c("fully closed", "closed without further action")
unknown_statuses <- setdiff(unique(claims$ClaimStatus), c(open_statuses, closed_statuses))
if (length(unknown_statuses) > 0) {
  stop(sprintf("unmapped claim status(es): %s", paste(unknown_statuses, collapse = ", ")))
}

years <- sort(unique(exposures$Year))
if (!identical(years, 1995:2014)) stop("expected complete exposure years 1995 through 2014")
if (anyDuplicated(exposures$Year)) stop("exposure years must be unique")
if (sum(exposures$ClaimNb) != 735079L) stop("pinned source first-development claim count changed")
if (!all(claims$OccurYear %in% years) || !all(claims$ManagYear %in% years)) {
  stop("claim years fall outside the documented 1995-2014 range")
}

# Claim IDs are not perfectly unique in the source. We retain that fact, and
# combine same-ID/same-year dollar streams deterministically for triangle
# construction. Source ClaimNb remains the authoritative frequency measure.
claim_ids <- sort(unique(claims$ClaimID))
claim_index <- match(claims$ClaimID, claim_ids)
n_claims <- length(claim_ids)
first_id_row <- !duplicated(claim_index)
origin_by_claim <- integer(n_claims)
origin_by_claim[claim_index[first_id_row]] <- claims$OccurYear[first_id_row]
if (any(origin_by_claim[claim_index] != claims$OccurYear)) {
  stop("a source ClaimID maps to more than one occurrence year")
}

gross_paid_state <- numeric(n_claims)
gross_incurred_state <- numeric(n_claims)
recourse_state <- numeric(n_claims)
expected_recourse_state <- numeric(n_claims)
seen <- logical(n_claims)
last_evaluation_year <- integer(n_claims)
evaluation_count <- integer(n_claims)
open_state <- logical(n_claims)

metrics <- list(
  duplicate_claim_year_groups = 0,
  rows_in_duplicate_claim_year_groups = 0,
  paid_decrease_transitions = 0,
  recourse_decrease_transitions = 0,
  annual_gap_transitions = 0,
  first_evaluation_after_origin = 0,
  negative_gross_case_records = 0,
  negative_net_case_records = 0,
  closed_with_positive_gross_case_records = 0
)

triangle_rows <- list()
diagnostic_rows <- data.frame()
for (basis in c("gross_paid", "gross_incurred", "net_paid", "net_incurred")) {
  triangle_rows[[basis]] <- data.frame(origin = integer(), age = integer(), value = numeric())
}

for (evaluation_year in years) {
  source_rows <- which(claims$ManagYear == evaluation_year)
  ids_for_year <- claim_index[source_rows]
  per_id_counts <- tabulate(ids_for_year, nbins = n_claims)
  duplicate_ids <- which(per_id_counts > 1)
  metrics$duplicate_claim_year_groups <- metrics$duplicate_claim_year_groups + length(duplicate_ids)
  metrics$rows_in_duplicate_claim_year_groups <-
    metrics$rows_in_duplicate_claim_year_groups + sum(per_id_counts[duplicate_ids])

  amounts <- cbind(
    gross_paid = claims$PaidAmount[source_rows],
    gross_incurred = claims$ExpectCharge[source_rows],
    recourse = claims$RecourseAmount[source_rows],
    expected_recourse = claims$ExpectRecourse[source_rows]
  )
  combined <- rowsum(amounts, ids_for_year, reorder = TRUE)
  updated_ids <- as.integer(rownames(combined))
  open_by_id <- rowsum(
    as.integer(claims$ClaimStatus[source_rows] %in% open_statuses),
    ids_for_year,
    reorder = TRUE
  )
  if (!identical(rownames(combined), rownames(open_by_id))) {
    stop(sprintf("status and amount groups did not align in management year %d", evaluation_year))
  }
  combined_open <- open_by_id[, 1] > 0

  previously_seen <- seen[updated_ids]
  metrics$paid_decrease_transitions <- metrics$paid_decrease_transitions + sum(
    previously_seen & combined[, "gross_paid"] < gross_paid_state[updated_ids]
  )
  metrics$recourse_decrease_transitions <- metrics$recourse_decrease_transitions + sum(
    previously_seen & combined[, "recourse"] < recourse_state[updated_ids]
  )
  metrics$annual_gap_transitions <- metrics$annual_gap_transitions + sum(
    previously_seen & evaluation_year > last_evaluation_year[updated_ids] + 1
  )
  first_updates <- !previously_seen
  metrics$first_evaluation_after_origin <- metrics$first_evaluation_after_origin + sum(
    first_updates & evaluation_year > origin_by_claim[updated_ids]
  )

  gross_case <- combined[, "gross_incurred"] - combined[, "gross_paid"]
  net_paid <- combined[, "gross_paid"] - combined[, "recourse"]
  net_incurred <- combined[, "gross_incurred"] - combined[, "expected_recourse"]
  net_case <- net_incurred - net_paid
  metrics$negative_gross_case_records <- metrics$negative_gross_case_records + sum(gross_case < 0)
  metrics$negative_net_case_records <- metrics$negative_net_case_records + sum(net_case < 0)
  metrics$closed_with_positive_gross_case_records <-
    metrics$closed_with_positive_gross_case_records + sum(!combined_open & gross_case > 0)

  gross_paid_state[updated_ids] <- combined[, "gross_paid"]
  gross_incurred_state[updated_ids] <- combined[, "gross_incurred"]
  recourse_state[updated_ids] <- combined[, "recourse"]
  expected_recourse_state[updated_ids] <- combined[, "expected_recourse"]
  seen[updated_ids] <- TRUE
  last_evaluation_year[updated_ids] <- evaluation_year
  evaluation_count[updated_ids] <- evaluation_count[updated_ids] + 1L
  open_state[updated_ids] <- combined_open

  for (origin_year in years[years <= evaluation_year]) {
    members <- origin_by_claim == origin_year
    age <- (evaluation_year - origin_year + 1L) * 12L
    triangle_rows$gross_paid <- rbind(
      triangle_rows$gross_paid,
      data.frame(origin = origin_year, age = age, value = sum(gross_paid_state[members]))
    )
    triangle_rows$gross_incurred <- rbind(
      triangle_rows$gross_incurred,
      data.frame(origin = origin_year, age = age, value = sum(gross_incurred_state[members]))
    )
    triangle_rows$net_paid <- rbind(
      triangle_rows$net_paid,
      data.frame(
        origin = origin_year,
        age = age,
        value = sum(gross_paid_state[members] - recourse_state[members])
      )
    )
    triangle_rows$net_incurred <- rbind(
      triangle_rows$net_incurred,
      data.frame(
        origin = origin_year,
        age = age,
        value = sum(gross_incurred_state[members] - expected_recourse_state[members])
      )
    )
    reported <- sum(members & seen)
    open <- sum(members & seen & open_state)
    closed_with_pay <- sum(members & seen & !open_state & gross_paid_state > 0)
    closed_no_pay <- reported - open - closed_with_pay
    diagnostic_rows <- rbind(diagnostic_rows, data.frame(
      origin = origin_year,
      valuation = evaluation_year,
      reported = reported,
      open = open,
      closed_no_pay = closed_no_pay,
      closed_with_pay = closed_with_pay,
      gross_paid = sum(gross_paid_state[members]),
      gross_incurred = sum(gross_incurred_state[members]),
      net_paid = sum(gross_paid_state[members] - recourse_state[members]),
      net_incurred = sum(gross_incurred_state[members] - expected_recourse_state[members])
    ))
  }
}

dir.create(compact_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(full_dir, recursive = TRUE, showWarnings = FALSE)

write.csv(
  data.frame(
    origin = exposures$Year,
    exposure_units = exposures$Exposure,
    gross_written_premium = exposures$GWP,
    source_claim_count = exposures$ClaimNb
  ),
  file.path(compact_dir, "exposures.csv"),
  row.names = FALSE,
  quote = FALSE
)
for (basis in names(triangle_rows)) {
  write.csv(
    triangle_rows[[basis]],
    file.path(compact_dir, sprintf("%s.csv", gsub("_", "-", basis))),
    row.names = FALSE,
    quote = FALSE
  )
}
if (nrow(diagnostic_rows) != 210L) stop("diagnostic derivative must contain 210 upper-triangle cells")
if (any(diagnostic_rows$reported != diagnostic_rows$open + diagnostic_rows$closed_no_pay + diagnostic_rows$closed_with_pay)) stop("diagnostic claim counts do not reconcile")
if (any(!is.finite(as.matrix(diagnostic_rows[, 3:ncol(diagnostic_rows)])))) stop("diagnostic derivative contains non-finite values")
write.csv(diagnostic_rows, file.path(compact_dir, "diagnostic-snapshots.csv"), row.names = FALSE, quote = FALSE)

diagonal <- claims$OccurYear == claims$ManagYear
quality <- data.frame(
  metric = c(
    "source_claim_rows",
    "distinct_claim_ids",
    "source_first_development_claim_count",
    "claim_id_collisions_at_first_development",
    "first_evaluation_after_origin",
    "duplicate_claim_year_groups",
    "rows_in_duplicate_claim_year_groups",
    "exact_duplicate_extra_rows",
    "claims_with_multiple_evaluations",
    "maximum_evaluations_per_claim",
    "annual_gap_transitions",
    "paid_decrease_transitions",
    "recourse_decrease_transitions",
    "negative_gross_case_records",
    "negative_net_case_records",
    "closed_with_positive_gross_case_records"
  ),
  value = c(
    nrow(claims),
    n_claims,
    sum(exposures$ClaimNb),
    sum(diagonal) - length(unique(claims$ClaimID[diagonal])),
    metrics$first_evaluation_after_origin,
    metrics$duplicate_claim_year_groups,
    metrics$rows_in_duplicate_claim_year_groups,
    sum(duplicated(claims)),
    sum(evaluation_count > 1),
    max(evaluation_count),
    metrics$annual_gap_transitions,
    metrics$paid_decrease_transitions,
    metrics$recourse_decrease_transitions,
    metrics$negative_gross_case_records,
    metrics$negative_net_case_records,
    metrics$closed_with_positive_gross_case_records
  )
)
write.csv(quality, file.path(compact_dir, "quality-summary.csv"), row.names = FALSE, quote = FALSE)

# The opt-in full artifact preserves source status and both gross/net measures.
# It remains ignored because a million-row CSV does not belong in an npm
# package or its routine test path.
full_rows <- data.frame(
  claim_id = claims$ClaimID,
  origin_year = claims$OccurYear,
  evaluation_year = claims$ManagYear,
  status = ifelse(claims$ClaimStatus %in% open_statuses, "open", "closed"),
  source_status = claims$ClaimStatus,
  gross_paid_to_date = claims$PaidAmount,
  gross_incurred_to_date = claims$ExpectCharge,
  net_paid_to_date = claims$PaidAmount - claims$RecourseAmount,
  net_incurred_to_date = claims$ExpectCharge - claims$ExpectRecourse
)
write.csv(
  full_rows,
  file.path(full_dir, "freclaimset2motor-annual.csv"),
  row.names = FALSE,
  quote = TRUE
)

cat(sprintf("Wrote %d compact triangle cells per basis and %d full annual rows.\n",
            nrow(triangle_rows$net_paid), nrow(full_rows)))
