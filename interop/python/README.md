# actuarial-interchange (Python)

Python adapter for the actuarial-interchange spec v1. See
`docs/spec/actuarial-interchange.md` (the
normative spec) and `schema/interchange/1.0/` (JSON Schema + JCS vectors).

- Core: stdlib only — canonical JSON (RFC 8785/JCS), FNV-1a integrity,
  document dataclasses, version-checked parse/serialize.
- `[chainladder]` extra: bridges to/from chainladder-python Triangles,
  Development estimators, and fitted method results.

```bash
pip install -e ".[chainladder]"
pytest tests -q
```
