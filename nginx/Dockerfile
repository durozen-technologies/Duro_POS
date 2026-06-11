# syntax=docker/dockerfile:1.7

ARG NGINX_IMAGE=nginx:stable-alpine3.23

FROM ${NGINX_IMAGE} AS config-check

COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf /etc/nginx/conf.d/default.conf

RUN nginx -t


FROM ${NGINX_IMAGE} AS runtime

ARG NGINX_UID=10101
ARG NGINX_GID=10101

RUN addgroup -S -g "${NGINX_GID}" nginxapp \
    && adduser -S -D -H -u "${NGINX_UID}" -G nginxapp nginxapp \
    && mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
    && chown -R nginxapp:nginxapp /tmp /var/cache/nginx /etc/nginx /var/run

COPY --from=config-check --chown=nginxapp:nginxapp /etc/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=config-check --chown=nginxapp:nginxapp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
STOPSIGNAL SIGQUIT

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD nginx -t && test -s /tmp/nginx.pid && kill -0 "$(cat /tmp/nginx.pid)"

USER nginxapp:nginxapp
