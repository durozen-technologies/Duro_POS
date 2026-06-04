# RustFS

RustFS provides S3-compatible object storage for item images.

## Responsibilities

- Store full item images
- Store generated thumbnails
- Keep binary image data out of Postgres
- Serve objects through the backend or public base URL when enabled

## Key Files

```text
rustfs/Dockerfile
rustfs/docker-entrypoint.sh
rustfs/data/.gitkeep
backend/app/services/storage.py
backend/app/db/storage.py
backend/app/db/startup.py
backend/scripts/backfill_item_thumbnails.py
```

## Production Compose Service

Defined in `docker-compose.prod.yml`:

```yaml
rustfs:
  image: rustfs/rustfs:latest
  profiles: ["infra"]
  ports:
    - "9000:9000"
    - "9001:9001"
```

Important environment:

```env
RUSTFS_ACCESS_KEY=...
RUSTFS_SECRET_KEY=...
RUSTFS_SERVER_DOMAINS=...
RUSTFS_DATA_DIR=/home/ubuntu/rustfs/data
```

Backend settings:

```env
RUSTFS_ENDPOINT_URL=http://rustfs:9000
RUSTFS_ACCESS_KEY_ID=...
RUSTFS_SECRET_ACCESS_KEY=...
RUSTFS_BUCKET_NAME=pos-mlb-items
RUSTFS_REGION_NAME=us-east-1
RUSTFS_PUBLIC_BASE_URL=
RUSTFS_PUBLIC_READ_ENABLED=False
```

## Persistence

Production data is bind-mounted:

```text
/home/ubuntu/rustfs/data -> /data
```

## Image Storage Contract

Use database metadata to reference objects:

```text
image_object_key
image_content_type
image_thumb_object_key
```

Do not add or use an `image_data` byte column in Postgres.

## Startup Behavior

Backend startup and migration code can:

- initialize the RustFS bucket
- migrate legacy image bytes to RustFS when configured
- ensure image metadata is usable

New image uploads should fail if RustFS is expected but unavailable.

## Healthcheck

The compose healthcheck accepts typical RustFS HTTP responses:

```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/
```

Expected codes include `200`, `403`, or `404`.

