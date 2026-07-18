# chainladder-python compute sidecar (spec rev 2.1 section 7).
#
# Build from the REPO ROOT (the context must include interop/python, the
# actuarial-interchange package the sidecar consumes):
#
#   docker build -f interop/sidecar/Dockerfile -t actuarial-sidecar .
#   docker run -e SIDECAR_TOKEN=... -p 8091:8091 actuarial-sidecar
#
# The image pins python:3.12 + the exact requirements versions: the image
# IS the version contract the conformance suite runs against.

FROM python:3.12-slim

WORKDIR /srv

COPY interop/sidecar/requirements.txt /srv/interop/sidecar/requirements.txt
RUN pip install --no-cache-dir -r /srv/interop/sidecar/requirements.txt

COPY interop/python /srv/interop/python
RUN pip install --no-cache-dir /srv/interop/python

COPY interop/sidecar /srv/interop/sidecar

ENV PYTHONPATH=/srv/interop
EXPOSE 8091

# SIDECAR_TOKEN must be provided at run time; the factory refuses to boot
# without it (no unauthenticated compute surface, ever).
CMD ["uvicorn", "--factory", "sidecar.app:create_app", "--host", "0.0.0.0", "--port", "8091"]
