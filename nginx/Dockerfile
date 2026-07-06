# syntax=docker/dockerfile:1.7

ARG NGINX_VERSION=1.27.5
ARG NGINX_IMAGE=nginx:${NGINX_VERSION}-alpine3.21
ARG NGINX_UID=10101
ARG NGINX_GID=10101
ARG BUILD_VERSION=dev
ARG BUILD_REVISION=unknown

FROM ${NGINX_IMAGE} AS config-check

COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf /etc/nginx/conf.d/default.conf

RUN nginx -t


FROM ${NGINX_IMAGE} AS runtime

ARG NGINX_UID
ARG NGINX_GID
ARG BUILD_VERSION
ARG BUILD_REVISION

LABEL org.opencontainers.image.title="Brolier 360 Nginx" \
      org.opencontainers.image.description="Reverse proxy for local DuroPOS / Brolier 360 stacks" \
      org.opencontainers.image.vendor="Durozen" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REVISION}"

RUN addgroup -S -g "${NGINX_GID}" nginxapp \
    && adduser -S -D -H -u "${NGINX_UID}" -G nginxapp -s /sbin/nologin nginxapp \
    && mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
    && chown -R nginxapp:nginxapp /tmp /var/cache/nginx /etc/nginx /var/run

COPY --from=config-check --chown=nginxapp:nginxapp /etc/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=config-check --chown=nginxapp:nginxapp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf

USER nginxapp:nginxapp

EXPOSE 8080
STOPSIGNAL SIGQUIT

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/nginx-health >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
