# syntax=docker/dockerfile:1.7

FROM edoburu/pgbouncer:1.22.1-p0

USER root
COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

USER postgres
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
