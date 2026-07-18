"""chainladder-python compute sidecar (interop Phase C, spec rev 2.1 section 7).

Plain HTTP + JSON — the actuarial-interchange spec IS the wire contract.
Stateless by design: no persistence, no tenant identifiers anywhere in the
wire schema (opaque ``engagementRef`` passthrough only), bearer auth on the
compute surface, request-size limits.
"""
