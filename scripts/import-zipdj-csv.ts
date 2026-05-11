/**
 * Fast bulk import for ZipDJ TSV/CSV → zipdj_tracks_ai.
 *
 * Usage:
 *   npx tsx scripts/import-zipdj-csv.ts [path/to/file.tsv]
 *
 * Env tuning:
 *   ZIPDJ_IMPORT_BATCH_EMBED=48   — sentences per MiniLM forward pass
 *   ZIPDJ_IMPORT_BATCH_DB=120    — rows per INSERT
 *   ZIPDJ_IMPORT_REBUILD_INDEX=1 — DROP HNSW before load, recreate after (much faster)
 *
 * Expects DATABASE_URL in .env (same as the app).
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as readline from 'readline';
import { Pool } from 'pg';

import { embedTextsBatchToVectorLiterals } from '@/lib/server/embedder';
import { buildZipdjEmbeddingText } from '@/lib/server/zipdjEmbedding';
import { mapZipdjCsvRecord, type ZipdjMappedCsvRow } from '@/lib/shared/zipdjCsvMap';

const EMBED_BATCH = Math.max(1, parseInt(process.env.ZIPDJ_IMPORT_BATCH_EMBED || '48', 10));
const DB_BATCH = Math.max(1, parseInt(process.env.ZIPDJ_IMPORT_BATCH_DB || '120', 10));
const REBUILD_INDEX = process.env.ZIPDJ_IMPORT_REBUILD_INDEX === '1';

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS zipdj_tracks_ai_embedding_hnsw
  ON zipdj_tracks_ai USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
`;

function detectDelimiter(headerLine: string): '\t' | ',' {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

function splitRow(line: string, delimiter: '\t' | ','): string[] {
  if (delimiter === '\t') return line.split('\t');
  return line.split(',');
}

function rowToRecord(headers: string[], cols: string[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    rec[headers[i]] = cols[i] ?? '';
  }
  return rec;
}

function buildUpsertSql(n: number): string {
  const rowPlaceholders: string[] = [];
  let p = 1;
  for (let i = 0; i < n; i++) {
    rowPlaceholders.push(
      `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::vector)`
    );
  }
  return `
    INSERT INTO zipdj_tracks_ai (
      track_id, track_name, track_url, release_name, release_id,
      label_name, label_id, artists_name, genre, tags,
      track_created_date, release_created_date, embedding
    )
    VALUES ${rowPlaceholders.join(',')}
    ON CONFLICT (track_id) DO UPDATE SET
      track_name = EXCLUDED.track_name,
      track_url = EXCLUDED.track_url,
      release_name = EXCLUDED.release_name,
      release_id = EXCLUDED.release_id,
      label_name = EXCLUDED.label_name,
      label_id = EXCLUDED.label_id,
      artists_name = EXCLUDED.artists_name,
      genre = EXCLUDED.genre,
      tags = EXCLUDED.tags,
      track_created_date = EXCLUDED.track_created_date,
      release_created_date = EXCLUDED.release_created_date,
      embedding = EXCLUDED.embedding
  `;
}

function flattenRows(rows: ZipdjMappedCsvRow[], vectors: string[]): unknown[] {
  const params: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    params.push(
      r.track_id,
      r.track_name || '',
      r.track_url,
      r.release_name,
      r.release_id,
      r.label_name,
      r.label_id,
      r.artists_name,
      r.genre,
      r.tags,
      r.track_created_date,
      r.release_created_date,
      vectors[i]
    );
  }
  return params;
}

async function flushDb(pool: Pool, buffer: ZipdjMappedCsvRow[], vectors: string[]) {
  if (buffer.length === 0) return;
  const sql = buildUpsertSql(buffer.length);
  await pool.query(sql, flattenRows(buffer, vectors));
}

async function main() {
  const filePath = process.argv[2] || 'training_data/zipdj_ai_training2.csv';
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL is missing. Add it to .env');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
  });

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let headers: string[] | null = null;
  let delimiter: '\t' | ',' = '\t';

  let embedBuffer: ZipdjMappedCsvRow[] = [];
  let dbBuffer: ZipdjMappedCsvRow[] = [];
  let dbVectors: string[] = [];

  let totalRows = 0;
  let skipped = 0;

  async function flushEmbedBuffer(buf: ZipdjMappedCsvRow[]) {
    if (buf.length === 0) return;
    const texts = buf.map((r) =>
      buildZipdjEmbeddingText({
        release_name: r.release_name,
        track_name: r.track_name,
        artists_name: r.artists_name,
        genre: r.genre,
        tags: r.tags,
        label_name: r.label_name,
        label_id: r.label_id,
        release_id: r.release_id,
        track_created_date: r.track_created_date,
        release_created_date: r.release_created_date,
      })
    );
    const vecs = await embedTextsBatchToVectorLiterals(texts);
    for (let i = 0; i < buf.length; i++) {
      dbBuffer.push(buf[i]);
      dbVectors.push(vecs[i]);
      if (dbBuffer.length >= DB_BATCH) {
        await flushDb(pool, dbBuffer, dbVectors);
        totalRows += dbBuffer.length;
        console.error(`upserted ${totalRows} rows…`);
        dbBuffer = [];
        dbVectors = [];
      }
    }
  }

  console.error(
    `Import ${filePath} | embed_batch=${EMBED_BATCH} db_batch=${DB_BATCH} rebuild_index=${REBUILD_INDEX}`
  );

  if (REBUILD_INDEX) {
    console.error('Dropping zipdj_tracks_ai_embedding_hnsw …');
    await pool.query('DROP INDEX IF EXISTS zipdj_tracks_ai_embedding_hnsw');
  }

  try {
    for await (const line of rl) {
      lineNo++;
      if (!line.trim()) continue;

      if (!headers) {
        delimiter = detectDelimiter(line);
        headers = splitRow(line, delimiter).map((h) => h.trim());
        console.error(`Delimiter=${JSON.stringify(delimiter)} headers=${headers.length}`);
        continue;
      }

      const cols = splitRow(line, delimiter).slice(0, headers.length);
      if (cols.length < headers.length) {
        skipped++;
        continue;
      }

      const rec = rowToRecord(headers, cols);
      const mapped = mapZipdjCsvRecord(rec);
      if (!mapped) {
        skipped++;
        continue;
      }

      embedBuffer.push(mapped);

      if (embedBuffer.length >= EMBED_BATCH) {
        const chunk = embedBuffer;
        embedBuffer = [];
        await flushEmbedBuffer(chunk);
      }
    }

    if (embedBuffer.length > 0) {
      await flushEmbedBuffer(embedBuffer);
      embedBuffer = [];
    }

    if (dbBuffer.length > 0) {
      await flushDb(pool, dbBuffer, dbVectors);
      totalRows += dbBuffer.length;
      console.error(`upserted ${totalRows} rows…`);
    }

    if (REBUILD_INDEX) {
      console.error('Creating HNSW index (can take several minutes)…');
      await pool.query(INDEX_SQL);
    }

    console.error(`Done. Upserted ~${totalRows} rows, skipped lines=${skipped}, last_line=${lineNo}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
