#!/bin/sh

# Supply Promtail's host bind mounts from the Docker daemon selected by the
# current context. This supports both rootful Docker and rootless Docker
# without committing a machine-specific path to docker-compose.yml.
set -eu

if [ "$#" -eq 0 ]; then
	echo "Usage: $0 command [argument ...]" >&2
	exit 2
fi

if [ -z "${DOCKER_CONTAINERS_PATH:-}" ]; then
	DOCKER_ROOT_DIR=$(docker info --format '{{.DockerRootDir}}')
	if [ -z "$DOCKER_ROOT_DIR" ]; then
		echo "Docker did not report a data-root." >&2
		exit 1
	fi
	DOCKER_CONTAINERS_PATH=$DOCKER_ROOT_DIR/containers
	export DOCKER_CONTAINERS_PATH
fi

if [ -z "${DOCKER_SOCKET_PATH:-}" ]; then
	DOCKER_SOCKET_URL=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
	case "$DOCKER_SOCKET_URL" in
		unix://*)
			DOCKER_SOCKET_PATH=${DOCKER_SOCKET_URL#unix://}
			export DOCKER_SOCKET_PATH
			;;
		*)
			echo "Promtail requires a Unix Docker socket; got $DOCKER_SOCKET_URL." >&2
			exit 1
			;;
	esac
fi

exec "$@"
