# actuarial-interchange (Python)

Source-checkout Python adapter, generator version `0.2.0`, for
actuarial-interchange wire `1.1.0`. See `docs/spec/actuarial-interchange.md`
and `schema/interchange/1.1/` in the repository. The `1.0/` schemas and frozen
historical documents remain supported evidence, not files to regenerate for
an npm release. The Python generator version is independent of SDK 0.7.x.

- Core: stdlib only — canonical JSON (RFC 8785/JCS), FNV-1a integrity,
  document dataclasses, version-checked parse/serialize.
- Diagnostics: semantic definition validation and narrow aggregate-cell
  replay for the shared conformance corpus. This is not the full TypeScript
  ingestion pipeline or a Python reader for `diagnostic-replay/1` archives.
- `[chainladder]` extra: bridges to/from chainladder-python Triangles,
  Development estimators, and fitted method results.

The base adapter supports Python 3.10+. Full local conformance uses Python 3.12
and the pinned bridge. From the repository root, in an activated Python 3.12
virtual environment:

```bash
python -m pip install -e "interop/python[chainladder]" "chainladder==0.9.2" pytest
python -m pytest interop/python/tests -q
```

No PyPI publication is assumed by these instructions. For the complete pinned
sidecar and cross-engine test setup, follow `CONTRIBUTING.md` in the repository.
