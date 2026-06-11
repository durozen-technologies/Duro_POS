# syntax=docker/dockerfile:1.7

ARG RUSTFS_IMAGE=rustfs/rustfs:latest

FROM ${RUSTFS_IMAGE} AS entrypoint

USER root

WORKDIR /build

COPY docker-entrypoint.sh .

RUN chmod 0755 docker-entrypoint.sh


FROM ${RUSTFS_IMAGE} AS runtime

ARG RUSTFS_DATA_UID=10001
ARG RUSTFS_DATA_GID=10001

ENV RUSTFS_DATA_UID="${RUSTFS_DATA_UID}" \
    RUSTFS_DATA_GID="${RUSTFS_DATA_GID}"

USER root

COPY --from=entrypoint /build/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/data"]
