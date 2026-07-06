# syntax=docker/dockerfile:1.7

ARG RUSTFS_VERSION=1.0.0-beta.8
ARG RUSTFS_IMAGE=rustfs/rustfs:${RUSTFS_VERSION}
ARG RUSTFS_DATA_UID=10001
ARG RUSTFS_DATA_GID=10001
ARG RUSTFS_USER=rustfs
ARG RUSTFS_GROUP=rustfs
ARG BUILD_VERSION=dev
ARG BUILD_REVISION=unknown

FROM ${RUSTFS_IMAGE} AS upstream

FROM upstream AS runtime

ARG RUSTFS_DATA_UID
ARG RUSTFS_DATA_GID
ARG RUSTFS_USER
ARG RUSTFS_GROUP
ARG BUILD_VERSION
ARG BUILD_REVISION

ENV RUSTFS_DATA_UID="${RUSTFS_DATA_UID}" \
    RUSTFS_DATA_GID="${RUSTFS_DATA_GID}" \
    HOME=/data

LABEL org.opencontainers.image.title="Brolier 360 RustFS" \
      org.opencontainers.image.description="Hardened RustFS object storage runtime for DuroPOS" \
      org.opencontainers.image.vendor="Durozen" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REVISION}"

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN set -eux; \
    if ! grep -Eq "^[^:]+:[^:]*:${RUSTFS_DATA_GID}:" /etc/group; then \
        echo "${RUSTFS_GROUP}:x:${RUSTFS_DATA_GID}:" >> /etc/group; \
    fi; \
    if ! grep -Eq "^[^:]+:[^:]*:${RUSTFS_DATA_UID}:" /etc/passwd; then \
        echo "${RUSTFS_USER}:x:${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}:RustFS runtime user:/data:/sbin/nologin" >> /etc/passwd; \
    fi; \
    mkdir -p /data /logs; \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh; \
    chown -R "${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}" /data /logs /usr/local/bin/docker-entrypoint.sh

USER ${RUSTFS_DATA_UID}:${RUSTFS_DATA_GID}

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:9000/ || wget -qO- http://127.0.0.1:9000/ >/dev/null

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/data"]