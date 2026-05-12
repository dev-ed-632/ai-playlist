# PostgreSQL and pgvector for this project

The app stores **384-dimensional** embeddings (`vector(384)`) and uses **cosine distance** (`<=>`) with **HNSW** indexes (`vector_cosine_ops`). That requires **PostgreSQL** plus the **`vector`** extension from **[pgvector](https://github.com/pgvector/pgvector)**.

## Local Docker (recommended)

The repo includes **`docker-compose.yml`** using the official **`pgvector/pgvector:pg18`** image (Postgres 18 + pgvector preinstalled).

1. **Free host port `5433`** — if another container (e.g. plain `postgres:18`) already binds `5433`, stop it first:
   - `docker stop my-postgres` (or whatever uses that port).

2. **Start the database**
   - `npm run db:docker:up`
   - First start creates the data volume and runs **`schema.sql`** automatically (extension + `tracks` + `zipdj_tracks_ai` + indexes).

3. **`.env`**
   - `DATABASE_URL=postgresql://postgres:postgres123@localhost:5433/zipdj_ai`
   - Change user/password in **both** `docker-compose.yml` and `.env` if you customize them.

4. **Reset database (destructive)** — removes the Docker volume and all data:
   - `npm run db:docker:down`
   - Then `npm run db:docker:up` again for a fresh init.

   **PostgreSQL 18+ in Docker:** the compose file mounts the volume at **`/var/lib/postgresql`** (not `.../data`), which matches upstream image expectations and avoids init crash loops.

5. **Apply `schema.sql` again on an already-initialized volume** (e.g. after editing the file; may error if objects already exist):
   - `npm run db:apply-schema`

## Moving to a server (managed or self-hosted)

### PostgreSQL version

| Target | Notes |
|--------|--------|
| **Recommended** | **PostgreSQL 16–18** — matches local Docker image, well tested with current pgvector builds. |
| **Minimum (practical)** | **PostgreSQL 14+** with a **current pgvector** release. Older majors may work but are not the focus of this stack. |

The stock **`postgres` Docker Hub image** does **not** include pgvector. Use **`pgvector/pgvector`** (or install the `vector` extension from your OS / Postgres distribution).

### Required extension

- Run once per database (as a superuser or role with `CREATE` on the DB):
  - `CREATE EXTENSION IF NOT EXISTS vector;`
- **`schema.sql`** already includes this line.

### Features this project relies on

- Type **`vector(384)`** and casts like **`$1::vector`**.
- **Cosine distance** operator **`<=>`** with **`vector_cosine_ops`** for HNSW (see `schema.sql` / `migrations/002_zipdj_tracks_ai.sql`).
- **HNSW** indexes (`USING hnsw`) — require a **recent pgvector** (the images from `pgvector/pgvector` satisfy this).

### Connection string (`DATABASE_URL`)

- Standard libpq URL: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`.
- **TLS**: managed providers (Neon, RDS, etc.) often require **`sslmode=require`** (append to the query string if needed).
- The app uses **`pg`** with a small pool (`lib/db.ts`); no Neon-specific driver is required.

### Operational extras (server)

1. **Disk** — large ZipDJ CSV imports and HNSW indexes need sufficient space; HNSW build is CPU- and memory-heavy during `CREATE INDEX`.
2. **Memory** — index builds and heavy batch inserts benefit from raised `maintenance_work_mem` for the session doing index creation (optional tuning).
3. **Backups** — include the database **and** extension compatibility on restore target (same or newer Postgres + pgvector).
4. **Migrations** — besides `schema.sql`, optional incremental files live in **`migrations/`** (see comments in each file; **`003`** truncates `zipdj_tracks_ai` — do not run blindly on production).

### Quick verification on any host

```sql
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

After `schema.sql`, you should have tables **`tracks`** and **`zipdj_tracks_ai`** and HNSW indexes on **`embedding`**.
