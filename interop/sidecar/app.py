"""FastAPI app factory: auth middleware + limits + the three endpoints.

Surface (spec 7):

- ``POST /v1/run/{method}`` — bearer auth; spec-7 wire shape in,
  MethodResultDoc | StochasticResultDoc out.
- ``GET /v1/engine`` — bearer auth; engine identity, methods, profiles.
- ``GET /v1/health`` — unauthenticated liveness.

Compute runs ON the event loop (async endpoints, sync chainladder calls):
requests are deliberately serialized so the replay-warning capture — which
uses the process-global ``warnings`` machinery — can never interleave.
A reserving-triangle run is milliseconds-to-seconds; correctness of the
warnings that land in result documents outranks concurrency here.

OpenAPI/docs endpoints are disabled: the wire contract is the interchange
spec, and the privacy posture favors the smallest possible surface.
"""

from __future__ import annotations

import hmac
from typing import Optional

import chainladder as cl
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from actuarial_interchange import GENERATOR_NAME, GENERATOR_VERSION, SPEC_VERSION

from .config import ENGINE_NAME, PROFILES, SidecarConfig, config_from_env
from .methods import METHODS, run_method
from .wire import SidecarError, created_at_now, error_body, parse_run_request

__all__ = ["create_app"]

_AUTHENTICATED_PREFIXES = ("/v1/run/", "/v1/engine")


def _needs_auth(path: str) -> bool:
    return path == "/v1/engine" or path.startswith("/v1/run")


def _bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("authorization")
    if header is None:
        return None
    scheme, _, credentials = header.partition(" ")
    if scheme.lower() != "bearer" or not credentials.strip():
        return None
    return credentials.strip()


def create_app(config: Optional[SidecarConfig] = None) -> FastAPI:
    """Build the sidecar app. With no argument, configuration comes from the
    environment (``SIDECAR_TOKEN`` required — boot fails loudly without it)."""
    if config is None:
        config = config_from_env()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def _auth_and_limits(request: Request, call_next):
        if _needs_auth(request.url.path):
            provided = _bearer_token(request)
            if provided is None or not hmac.compare_digest(
                provided.encode(), config.token.encode()
            ):
                return JSONResponse(
                    error_body(
                        "UNAUTHORIZED",
                        "a valid 'Authorization: Bearer <SIDECAR_TOKEN>' header "
                        "is required for /v1/run/* and /v1/engine",
                    ),
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
            declared = request.headers.get("content-length")
            # The length/size guards apply only to the body-bearing run route;
            # GET /v1/engine legitimately carries no Content-Length.
            if not request.url.path.startswith("/v1/run"):
                return await call_next(request)
            if declared is None:
                # No content-length means chunked/streamed: the size guard
                # below could not fire and `await request.body()` would buffer
                # the whole (possibly unbounded) body first. Refuse up front so
                # the memory-protection intent holds BEFORE the allocation.
                return JSONResponse(
                    error_body(
                        "LENGTH_REQUIRED",
                        "requests to /v1/run/* must carry a Content-Length header "
                        "(chunked/streamed bodies are refused so the size limit "
                        "is enforced before buffering)",
                    ),
                    status_code=411,
                )
            if declared.isdigit() and int(declared) > config.max_request_bytes:
                return JSONResponse(
                    error_body(
                        "REQUEST_TOO_LARGE",
                        f"declared content-length {declared} exceeds the "
                        f"{config.max_request_bytes}-byte limit",
                    ),
                    status_code=413,
                )
        return await call_next(request)

    @app.get("/v1/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/v1/engine")
    async def engine() -> dict:
        return {
            "name": ENGINE_NAME,
            "version": cl.__version__,
            "profiles": list(PROFILES),
            "methods": [
                {"name": entry.name, "resultKind": entry.result_kind}
                for entry in METHODS.values()
            ],
            "interchange": {
                "specVersion": SPEC_VERSION,
                "generator": {"name": GENERATOR_NAME, "version": GENERATOR_VERSION},
            },
        }

    @app.post("/v1/run/{method}")
    async def run(method: str, request: Request) -> JSONResponse:
        raw = await request.body()
        try:
            run_request = parse_run_request(raw, config.max_request_bytes)
            document = run_method(method, run_request, created_at_now())
        except SidecarError as exc:
            return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status)
        except RecursionError:
            # A pathologically nested payload (recursion bomb) is a malformed
            # CLIENT request, not a server fault — answer 422, not 500.
            return JSONResponse(
                error_body(
                    "PAYLOAD_TOO_DEEP",
                    "request JSON is nested too deeply to process",
                ),
                status_code=422,
            )
        except Exception as exc:  # noqa: BLE001 — schema'd 500, no stack leak
            return JSONResponse(
                error_body("INTERNAL_ERROR", f"{type(exc).__name__} while running {method}"),
                status_code=500,
            )
        return JSONResponse(document.to_dict())

    return app
