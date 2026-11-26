PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE episode(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, chapter TEXT NOT NULL,
  story_type INTEGER, previous_id INTEGER, next_id INTEGER, frame_count INTEGER NOT NULL
);
CREATE TABLE scene(
  id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES episode(id),
  ordinal INTEGER NOT NULL, first_line INTEGER NOT NULL, last_line INTEGER NOT NULL, background TEXT,
  UNIQUE(episode_id,ordinal)
);
CREATE TABLE speaker(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE pose(id INTEGER PRIMARY KEY, motions TEXT NOT NULL);
CREATE TABLE frame(
  id INTEGER PRIMARY KEY, scene_id INTEGER NOT NULL REFERENCES scene(id), line INTEGER NOT NULL,
  speaker_id INTEGER REFERENCES speaker(id), phrase TEXT NOT NULL,
  bg TEXT, bgm TEXT, se TEXT, voice TEXT, active_bgm TEXT,
  pose_id INTEGER REFERENCES pose(id), line_order INTEGER, group_order INTEGER,
  UNIQUE(scene_id,line)
);
CREATE TABLE asset(
  kind TEXT NOT NULL, id TEXT NOT NULL, in_catalog INTEGER NOT NULL,
  PRIMARY KEY(kind,id)
) WITHOUT ROWID;
CREATE TABLE scene_asset(
  scene_id INTEGER NOT NULL REFERENCES scene(id), kind TEXT NOT NULL, resource_id TEXT NOT NULL,
  sample_frame INTEGER NOT NULL REFERENCES frame(id),
  cue_count INTEGER NOT NULL, active_frames INTEGER NOT NULL,
  PRIMARY KEY(scene_id,kind,resource_id),
  FOREIGN KEY(kind,resource_id) REFERENCES asset(kind,id)
) WITHOUT ROWID;
CREATE TABLE speaker_stat(
  speaker_id INTEGER NOT NULL REFERENCES speaker(id), kind TEXT NOT NULL, value INTEGER NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY(speaker_id,kind,value)
) WITHOUT ROWID;
CREATE VIRTUAL TABLE phrase_search USING fts5(phrase, content='frame', content_rowid='id', tokenize='trigram', detail=none, columnsize=0);
