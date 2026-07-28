#!/usr/bin/env bash
#
# Shared preamble for the container engine: pick an engine, confirm it is reachable, build
# the image.
#
# **This is not meant to be executed; it is meant to be `source`d by other scripts** —
# `test-in-container.sh` (running tests) and `capture-evidence.sh` (taking screenshots) both
# have to run in the same image, and "how to talk to the container engine" can only have one
# answer. Written separately, the two sides' diagnostics for the rootless socket and their
# handling of proxies would sooner or later drift, and on the day they did, one script would
# work on a machine where the other did not — a symptom whose root cause ("there are two
# configurations") is very hard to trace.
#
# After sourcing, available are:
#   ENGINE           podman or docker
#   REPO_ROOT        the absolute path of the repo root
#   IMAGE_NAME       the image name
#   container_build  builds the image
#
# When a new way of running containers is needed, **add a script and source this one**;
# do not leave a bare docker command in documentation or a commit message (AGENTS.md).

IMAGE_NAME="${FROND_TEST_IMAGE:-frond-test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# podman first. The reason is not preference but the permission model: docker's socket is
# equivalent to host root, and adding a developer or an agent to the docker group opens a
# privilege escalation path. Rootless podman runs under an ordinary uid, with no daemon and
# no root-equivalent socket.
if command -v podman >/dev/null 2>&1; then
    ENGINE=podman
elif command -v docker >/dev/null 2>&1; then
    ENGINE=docker
else
    echo "Neither podman nor docker found. For installation see docs/test-environment.md." >&2
    exit 1
fi

# The engine being on PATH does not mean the daemon is reachable. Without this step, a
# misconfigured machine gets all the way to the build before blowing up, and the error
# message is that a socket path does not exist — which looks like "not installed" when in
# fact it is installed and the client is pointed at the wrong place, and the two call for
# entirely different responses.
#
# This only **diagnoses**; it does not act on the user's behalf: the socket's location
# belongs to the container engine's configuration, not to a test script's responsibility
# (the same reasoning as the proxy note in the build section). A script guessing where the
# socket is would silently fix a misconfigured machine, and then nobody would know it was
# misconfigured.
if ! "$ENGINE" info >/dev/null 2>&1; then
    echo "Found ${ENGINE} but cannot reach the daemon." >&2
    if [[ "$ENGINE" == docker && -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" ]]; then
        # A rootless dockerd is running, but the client still points at the rootful
        # /var/run/docker.sock. dockerd-rootless-setuptool.sh asks for this step after
        # installation, and missing it produces no warning at all.
        echo "The rootless socket is at ${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock, but the client is not pointed at it. To connect:" >&2
        echo "    docker context create rootless --docker host=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" >&2
        echo "    docker context use rootless" >&2
    else
        echo "Check whether the daemon is running, and where the client points (docker context ls / DOCKER_HOST)." >&2
    fi
    echo "See docs/test-environment.md." >&2
    exit 1
fi

# Proxies are deliberately not handled here.
#
# The intuitive approach is passing the outer HTTP_PROXY in with --build-arg, but that is
# wrong: an egress proxy usually listens on 127.0.0.1, and that address inside the
# container's network namespace refers to the container's own loopback rather than the
# proxy outside. Passing it in only overrides the value the engine had already set
# correctly, and apt-get then hits connection refused.
#
# Proxies belong to the container engine's configuration rather than to a test script's
# responsibility. Rootless docker injects the daemon's proxy settings into every container
# itself (pointing at the slirp gateway rather than loopback). An environment with no proxy
# (GitHub Actions, say) needs no handling to begin with.
container_build() {
    echo "==> building ${IMAGE_NAME} with ${ENGINE}"
    "$ENGINE" build --tag "$IMAGE_NAME" "$REPO_ROOT"
}
