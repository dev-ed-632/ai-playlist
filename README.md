# AI Playlist

Next.js app for track ingest, **pgvector** similarity search, and playlist flows. Postgres holds catalog rows with audio-derived features and a **384-dimensional** embedding (same space as `Xenova/all-MiniLM-L6-v2`).

## Getting started

Set `DATABASE_URL` (see `lib/db.ts` for default). Apply `schema.sql`, then `migrations/` if your DB predates those columns.

```bash
bun install
bun dev
```

App runs on **port 3022** by default (`package.json`).

---

## Database

PostgreSQL with the **`vector`** extension. All catalog data lives in **`tracks`**. Similarity uses **cosine-style** distance (`embedding <-> query`) with an **HNSW** index for fast approximate nearest-neighbor search.

### Entity relationship (Mermaid)

```mermaid
erDiagram
  tracks {
    uuid id PK
    text track_name
    text artist_names
    text track_url
    text genre
    int bpm
    text external_track_id
    text release_name
    text label
    text musical_key
    boolean is_explicit
    float danceability
    float mood_happy
    float mood_sad
    float mood_relaxed
    float aggressiveness
    float engagement
    float approachability
    vector embedding
  }
```

`artist_names` is `TEXT[]` in Postgres; Mermaid shows it as a single logical field. `embedding` is `vector(384)` with an HNSW index (`vector_cosine_ops`).

### Table layout (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ tracks                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ id (uuid, PK)                                                                │
│ track_name, artist_names[], track_url, genre, bpm                             │
│ external_track_id (unique when set), release_name, label, musical_key       │
│ is_explicit                                                                  │
│ danceability, mood_*, aggressiveness, engagement, approachability (0–1)      │
│ embedding vector(384)  ←── MiniLM-aligned; HNSW (vector_cosine_ops)         │
└─────────────────────────────────────────────────────────────────────────────┘
       ▲                          ▲
       │                          │
   ingest / CSV              query embedding
   builds text +              from UI or LLM
   audio features             narrative
```

Indexes (from `schema.sql`): `genre`, `label`, `musical_key`, `bpm`, partial unique on `external_track_id`, **HNSW on `embedding`**.

---

## Search vs filter (two different APIs)

| Path | Method | Role |
|------|--------|------|
| `/api/search` | `POST` | **Hybrid** semantic + metadata signals (vibe slider, optional keyword, optional mood tag). Uses embeddings + SQL scoring + artist diversification. |
| `/api/tracks/browse` | `GET` | **Filter only** — `ILIKE` on name/artist/genre/label/key/external id, BPM range, `media` (`all` / `youtube` / `audio`). **No vectors.** |

### End-to-end: hybrid search (`POST /api/search`)

```mermaid
flowchart TB
  subgraph client["Browser /search"]
    A[vibe slider, text query, tag chips]
  end
  subgraph api["app/api/search/route.ts"]
    B[Map vibe → target BPM, energy, relaxed, dance, happy]
    C{Mode?}
    C -->|keyword| D[Embed: framed music text from query]
    C -->|tag| E[Embed: synthetic line from vibe + tag]
    C -->|slider only| F[Embed: synthetic line from targets]
    D --> G["embedTextToVectorLiteral (MiniLM)"]
    E --> G
    F --> G
    G --> H["SQL: candidates + vec_dist + kw_score + bpm_score..."]
    H --> I["hybrid_score (weights depend on mode)"]
    I --> J["ORDER BY hybrid_score, LIMIT 50"]
    J --> K["diversifyTracks() → 12 rows"]
  end
  subgraph db["PostgreSQL"]
    L[(tracks.embedding <-> query)]
  end
  A --> B
  G --> L
  L --> H
  K --> client
```

**Modes (server):**

1. **Keyword** — `searchQuery` set: `ILIKE` pattern on title (strongest), artists, genre, combined with vector distance; BPM band filter is **off** so recall stays high.
2. **Tag** — e.g. `dance` / `happy` / `relaxed`: SQL **requires** the matching mood/feature column above a threshold, then ranks by semantics + energy + BPM.
3. **Slider-only** — no keyword/tag: synthetic embed from vibe; candidates constrained to **BPM ± 45** around target BPM; score blends vector distance, energy, relaxed, BPM.

After SQL, **`lib/server/diversify.ts`** re-orders the top pool so the same artist does not dominate consecutive slots.

### End-to-end: browse filter (`GET /api/tracks/browse`)

```mermaid
flowchart LR
  Q[Query string params] --> W[Dynamic WHERE ... AND ...]
  W --> T[(tracks)]
  T --> O["ORDER BY track_name"]
  O --> L[LIMIT 1–200]
```

Query parameters: `name`, `artist`, `genre`, `label`, `key`, `externalId`, `bpmMin`, `bpmMax`, `media`, `limit`. All conditions are optional; unset params are ignored (`NULL` in SQL).

---

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [pgvector](https://github.com/pgvector/pgvector)
