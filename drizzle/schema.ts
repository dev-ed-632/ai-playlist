import { pgTable, index, uniqueIndex, uuid, text, integer, real, vector, boolean, date } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const tracks = pgTable("tracks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	trackName: text("track_name").notNull(),
	artistNames: text("artist_names").array(),
	genre: text(),
	bpm: integer(),
	danceability: real(),
	moodHappy: real("mood_happy"),
	moodSad: real("mood_sad"),
	moodRelaxed: real("mood_relaxed"),
	aggressiveness: real(),
	engagement: real(),
	approachability: real(),
	embedding: vector({ dimensions: 384 }),
	trackUrl: text("track_url"),
	externalTrackId: text("external_track_id"),
	releaseName: text("release_name"),
	label: text(),
	musicalKey: text("musical_key"),
	isExplicit: boolean("is_explicit"),
}, (table) => [
	index("tracks_bpm_idx").using("btree", table.bpm.asc().nullsLast().op("int4_ops")),
	index("tracks_embedding_idx").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")).with({m: "16",ef_construction: "64"}),
	uniqueIndex("tracks_external_track_id_key").using("btree", table.externalTrackId.asc().nullsLast().op("text_ops")).where(sql`(external_track_id IS NOT NULL)`),
	index("tracks_genre_idx").using("btree", table.genre.asc().nullsLast().op("text_ops")),
	index("tracks_label_idx").using("btree", table.label.asc().nullsLast().op("text_ops")),
	index("tracks_musical_key_idx").using("btree", table.musicalKey.asc().nullsLast().op("text_ops")),
]);

export const zipdjTracksAi = pgTable("zipdj_tracks_ai", {
	trackId: text("track_id").primaryKey().notNull(),
	trackName: text("track_name").default("").notNull(),
	trackUrl: text("track_url"),
	releaseName: text("release_name").notNull(),
	releaseId: text("release_id"),
	labelName: text("label_name"),
	labelId: text("label_id"),
	artistsName: text("artists_name"),
	genre: text(),
	tags: text(),
	embedding: vector({ dimensions: 384 }).notNull(),
	trackCreatedDate: date("track_created_date"),
	releaseCreatedDate: date("release_created_date"),
}, (table) => [
	index("zipdj_tracks_ai_embedding_hnsw").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")).with({m: "16",ef_construction: "64"}),
	index("zipdj_tracks_ai_genre_idx").using("btree", table.genre.asc().nullsLast().op("text_ops")),
	index("zipdj_tracks_ai_label_id_idx").using("btree", table.labelId.asc().nullsLast().op("text_ops")),
	index("zipdj_tracks_ai_release_id_idx").using("btree", table.releaseId.asc().nullsLast().op("text_ops")),
]);
