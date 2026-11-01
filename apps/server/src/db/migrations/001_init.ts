export const name = 'init';

export const sql = /* sql */ `
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE device_profiles (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('android','ios','windows','macos','linux')),
  form_factor         TEXT NOT NULL CHECK (form_factor IN ('mobile','tablet','desktop')),
  vendor              TEXT,
  model               TEXT,
  os_version          TEXT NOT NULL,
  browser             TEXT NOT NULL CHECK (browser IN ('chrome','edge','firefox','safari','samsung','opera')),
  browser_version     TEXT NOT NULL,
  engine              TEXT NOT NULL CHECK (engine IN ('chromium','firefox','webkit')),
  user_agent          TEXT NOT NULL,
  client_hints        TEXT,
  viewport_width      INTEGER NOT NULL,
  viewport_height     INTEGER NOT NULL,
  screen_width        INTEGER NOT NULL,
  screen_height       INTEGER NOT NULL,
  device_scale_factor REAL    NOT NULL DEFAULT 1,
  is_mobile           INTEGER NOT NULL DEFAULT 0,
  has_touch           INTEGER NOT NULL DEFAULT 0,
  locale              TEXT NOT NULL DEFAULT 'en-US',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  tags                TEXT NOT NULL DEFAULT '[]',
  source              TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('builtin','generated','custom','imported')),
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_profiles_filter ON device_profiles(enabled, platform, browser, form_factor);
CREATE INDEX idx_profiles_name   ON device_profiles(name);
CREATE INDEX idx_profiles_source ON device_profiles(source);

CREATE TABLE proxies (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  protocol              TEXT NOT NULL CHECK (protocol IN ('http','https','socks4','socks5')),
  host                  TEXT NOT NULL,
  port                  INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username              TEXT,
  password_enc          TEXT,
  remote_dns            INTEGER NOT NULL DEFAULT 1,
  notes                 TEXT,
  last_checked_at       TEXT,
  last_check_ok         INTEGER,
  last_check_latency_ms INTEGER,
  last_check_error      TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE url_lists (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE urls (
  id          INTEGER PRIMARY KEY,
  list_id     INTEGER NOT NULL REFERENCES url_lists(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  domain      TEXT NOT NULL,
  label       TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  UNIQUE (list_id, url)
);
CREATE INDEX idx_urls_list_domain ON urls(list_id, domain);

CREATE TABLE test_runs (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft','queued','running','paused','completed','cancelled','failed')),
  mode           TEXT NOT NULL CHECK (mode IN ('http','browser','both')),
  url_list_id    INTEGER REFERENCES url_lists(id) ON DELETE SET NULL,
  proxy_id       INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
  settings       TEXT NOT NULL,
  total_tasks    INTEGER NOT NULL DEFAULT 0,
  done_tasks     INTEGER NOT NULL DEFAULT 0,
  success_tasks  INTEGER NOT NULL DEFAULT 0,
  failed_tasks   INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
);
CREATE INDEX idx_runs_status ON test_runs(status, created_at);
CREATE INDEX idx_runs_created ON test_runs(created_at);

CREATE TABLE test_run_profiles (
  run_id      INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  profile_id  INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  PRIMARY KEY (run_id, profile_id)
);

CREATE TABLE test_tasks (
  id              INTEGER PRIMARY KEY,
  run_id          INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  url_id          INTEGER,
  url             TEXT NOT NULL,
  domain          TEXT NOT NULL,
  profile_id      INTEGER,
  engine          TEXT NOT NULL CHECK (engine IN ('http','browser')),
  status          TEXT NOT NULL CHECK (status IN ('pending','running','success','failed','error','cancelled')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  final_url       TEXT,
  final_status    INTEGER,
  redirect_count  INTEGER,
  total_time_ms   INTEGER,
  error_code      TEXT,
  error_message   TEXT,
  result          TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  UNIQUE (run_id, url_id, profile_id, engine)
);
CREATE INDEX idx_tasks_run_status ON test_tasks(run_id, status, id);
CREATE INDEX idx_tasks_run_domain ON test_tasks(run_id, domain);
CREATE INDEX idx_tasks_finished   ON test_tasks(finished_at);

CREATE TABLE redirect_hops (
  id                INTEGER PRIMARY KEY,
  task_id           INTEGER NOT NULL REFERENCES test_tasks(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  url               TEXT NOT NULL,
  status_code       INTEGER,
  location          TEXT,
  hop_type          TEXT NOT NULL CHECK (hop_type IN ('initial','http','meta','js','final')),
  method            TEXT NOT NULL DEFAULT 'GET',
  response_time_ms  INTEGER,
  remote_address    TEXT,
  headers           TEXT,
  error             TEXT,
  UNIQUE (task_id, seq)
);
`;
