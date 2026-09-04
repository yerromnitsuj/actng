source("tools/interop/actuarialInterchange.R")
directory <- "interop/conformance/fixtures/mortgage"
fixture <- jsonlite::fromJSON(file.path(directory, "mack-1999-tail.json"), simplifyVector = TRUE)
document <- ats_read_document(file.path(directory, fixture$triangle))
stopifnot(identical(document$integrity, fixture$triangleIntegrity))
model <- ChainLadder::MackChainLadder(
  ats_triangle_to_matrix(document), est.sigma = "Mack",
  tail = fixture$options$tailFactor,
  tail.se = fixture$options$tailStandardError,
  tail.sigma = fixture$options$tailSigma
)
rows <- summary(model)$ByOrigin
tolerance <- fixture$tolerances
stopifnot(
  all(abs(rows$Ultimate - fixture$engine$ultimate) <= tolerance$engineAbsolute),
  all(abs(rows$Mack.S.E - fixture$engine$standardError) <= tolerance$engineAbsolute),
  abs(sum(rows$Ultimate) - fixture$engine$totalUltimate) <= tolerance$engineAbsolute,
  abs(model$Total.Mack.S.E - fixture$engine$totalStandardError) <= tolerance$engineAbsolute,
  all(abs(rows$Ultimate / 1000 - fixture$publishedThousands$ultimate) <= tolerance$publishedUltimateThousands),
  all(abs(rows$Mack.S.E / 1000 - fixture$publishedThousands$standardError) <= tolerance$publishedStandardErrorThousands),
  abs(sum(rows$Ultimate) / 1000 - fixture$publishedThousands$totalUltimate) <= tolerance$publishedTotalUltimateThousands,
  abs(model$Total.Mack.S.E / 1000 - fixture$publishedThousands$totalStandardError) <= tolerance$publishedStandardErrorThousands
)
cat("Mack 1999 explicit tail: all nine origins and totals match the frozen three-shore fixture and printed Table 2\n")
