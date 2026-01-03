CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    preview TEXT,
    timestamp TEXT, 
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,  
    step_data TEXT NOT NULL,     
    FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS python_state (
    session_id TEXT PRIMARY KEY,
    state_data BLOB,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id);
CREATE INDEX IF NOT EXISTS idx_python_state_session_id ON python_state(session_id);