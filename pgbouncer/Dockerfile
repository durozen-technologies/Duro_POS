# syntax=docker/dockerfile:1.7

FROM edoburu/pgbouncer:1.22.1-p0

USER root
COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY healthcheck.sh /usr/local/bin/pgbouncer-healthcheck.sh
RUN apk add --no-cache postgresql-client \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh /usr/local/bin/pgbouncer-healthcheck.sh \
    && chown -R postgres:postgres /etc/pgbouncer

USER postgres
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
