# syntax=docker/dockerfile:1.7

ARG RUSTFS_IMAGE=rustfs/rustfs:latest

FROM ${RUSTFS_IMAGE} AS upstream

FROM upstream AS runtime

ARG RUSTFS_DATA_UID=10001
ARG RUSTFS_DATA_GID=10001
ARG RUSTFS_USER=rustfs
ARG RUSTFS_GROUP=rustfs

ENV RUSTFS_DATA_UID="${RUSTFS_DATA_UID}" \
    RUSTFS_DATA_GID="${RUSTFS_DATA_GID}" \
    HOME=/data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN set -eux; \
    if ! grep -Eq "^[^:]+:[^:]*:${RUSTFS_DATA_GID}:" /etc/group; then \
        echo "${RUSTFS_GROUP}:x:${RUSTFS_DATA_GID}:" >> /etc/group; \
    fi; \
    if ! grep -Eq "^[^:]+:[^:]*:${RUSTFS_DATA_UID}:" /etc/passwd; then \
        echo "${RUSTFS_USER}:x:${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}:RustFS runtime user:/data:/sbin/nologin" >> /etc/passwd; \
    fi; \
    mkdir -p /data; \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh; \
    chown -R "${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}" /data /usr/local/bin/docker-entrypoint.sh

USER ${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/data"]
