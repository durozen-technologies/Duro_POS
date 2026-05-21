FROM nginx:stable-alpine3.23

ARG NGINX_UID=10101
ARG NGINX_GID=10101

RUN addgroup -S -g "${NGINX_GID}" nginxapp \
    && adduser -S -D -H -u "${NGINX_UID}" -G nginxapp nginxapp \
    && mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
    && chown -R nginxapp:nginxapp /tmp /var/cache/nginx /etc/nginx /var/run

COPY --chown=nginxapp:nginxapp nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginxapp:nginxapp default.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

USER nginxapp:nginxapp
