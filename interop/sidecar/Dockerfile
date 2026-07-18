# chainladder-python compute sidecar (spec rev 2.1 section 7).
#
# Build from the REPO ROOT (the context must include interop/python, the
# actuarial-interchange package the sidecar consumes):
#
#   docker build -f interop/sidecar/Dockerfile -t actuarial-sidecar .
#   docker run -e SIDECAR_TOKEN=... -p 8091:8091 actuarial-sidecar
#
# The image pins python:3.12 + the exact requirements versions: the image
# IS the version contract the conformance suite runs against. For a
# reproducible deploy, digest-pin the base at build time, e.g.
#   FROM python:3.12-slim@sha256:<digest from `docker manifest inspect`>
# (left as a tag here so this repo builds without a network lookup; the
# digest pin is the deploy-time hardening step).

FROM python:3.12-slim

WORKDIR /srv

COPY interop/sidecar/requirements.txt /srv/interop/sidecar/requirements.txt
RUN pip install --no-cache-dir -r /srv/interop/sidecar/requirements.txt

COPY interop/python /srv/interop/python
RUN pip install --no-cache-dir /srv/interop/python

COPY interop/sidecar /srv/interop/sidecar

# Run as a non-root user (network-exposed service hardening).
RUN useradd --system --uid 10001 --home-dir /srv --no-create-home sidecar \
    && chown -R sidecar:sidecar /srv
USER sidecar

ENV PYTHONPATH=/srv/interop
EXPOSE 8091

# SIDECAR_TOKEN must be provided at run time; the factory refuses to boot
# without it (no unauthenticated compute surface, ever).
CMD ["uvicorn", "--factory", "sidecar.app:create_app", "--host", "0.0.0.0", "--port", "8091"]
