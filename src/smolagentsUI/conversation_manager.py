import warnings
import os
import json
import uuid
import datetime
import threading
import sqlite3
from typing import List, Dict, Optional
from .utils import serialize_python_state, deserialize_python_state

class ConversationManager:
    def __init__(self, storage_path: str = None):
        """
        Manages conversation sessions.
        
        Parameters:
        -----------
        storage_path : str 
            Path to the SQLite database file. If None, runs in in-memory mode.
        """
        # check file extension
        _, file_extension = os.path.splitext(storage_path) if storage_path else (None, None)
        if storage_path and file_extension.lower() != '.db':
            raise ValueError(f"Database file must have a SQLite database file (.db): {storage_path}")
        
        self.storage_path = storage_path
        self.lock = threading.RLock()
        self.sessions_cache = [] 

        # Initialize Database if storage_path is provided
        if self.storage_path:
            self._init_db()
            self._load_session_summaries()

    def _get_db_conn(self) -> sqlite3.Connection:
        """ Returns a new database connection. """
        if not self.storage_path:
            raise RuntimeError("No storage path defined for database connection.")
        
        try:
            conn = sqlite3.connect(self.storage_path)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            raise IOError(f"Could not connect to database at {self.storage_path}: {e}")

    def _init_db(self):
        """ Creates DB directory/file and initializes tables from SQL definition. """
        # Ensure directory exists. If not, create it.
        db_dir = os.path.dirname(os.path.abspath(self.storage_path))
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)

        # Locate and verify SQL file
        base_dir = os.path.dirname(os.path.abspath(__file__))
        sql_path = os.path.join(base_dir, 'SQL', 'sqlite_table_def.sql')
        
        if not sql_path.lower().endswith('.sql'):
            raise ValueError(f"Definition file must be a .sql file: {sql_path}")
            
        if not os.path.exists(sql_path):
            raise FileNotFoundError(f"SQL definition file not found at {sql_path}")

        # Create database tables and indexes
        try:
            with open(sql_path, 'r', encoding='utf-8') as f:
                schema = f.read()
            
            with self._get_db_conn() as conn:
                conn.executescript(schema)
        except Exception as e:
            raise IOError(f"Could not initialize database: {e}")

    def _load_session_summaries(self):
        """
        Populates sessions_cache with metadata from the DB.
        'steps' are set to None and lazy-loaded later.
        """
        try:
            with self._get_db_conn() as conn:
                cursor = conn.execute(
                    "SELECT session_id, timestamp, preview FROM sessions ORDER BY last_updated DESC"
                )
                rows = cursor.fetchall()
                
                self.sessions_cache = []
                for row in rows:
                    self.sessions_cache.append({
                        "id": row["session_id"],
                        "timestamp": row["timestamp"],
                        "preview": row["preview"],
                        "steps": None,
                        "python_state": None
                    })
        except Exception as e:
            print(f"Warning: Could not load initial metadata from DB: {e}")

    def get_session_summaries(self) -> List[Dict]:
        """
        Returns lightweight summaries. 
        Pulls directly from cache (which is populated on init).
        """
        with self.lock:
            return [{
                "id": s["id"], 
                "timestamp": s["timestamp"], 
                "preview": s.get("preview", "No preview")
            } for s in self.sessions_cache]

    def get_session(self, session_id: str) -> Optional[Dict]:
        """
        Returns the full data for a specific session, including python_state.
        """
        with self.lock:
            # check in cache first
            session = next((s for s in self.sessions_cache if s["id"] == session_id), None)
            
            if session is not None:
                # Load Steps if missing
                if session.get("steps") is None:
                    if self.storage_path:
                        try:
                            with self._get_db_conn() as conn:
                                cursor = conn.execute(
                                    "SELECT step_data FROM steps WHERE session_id = ? ORDER BY step_index ASC", 
                                    (session_id,)
                                )
                                step_rows = cursor.fetchall()
                                session["steps"] = [json.loads(row["step_data"]) for row in step_rows]
                        except Exception as e:
                            warnings.warn(f"Could not load session steps: {e}", RuntimeWarning)
                            session["steps"] = []
                    else:
                        session["steps"] = []

                # Load Python State if missing
                if session.get("python_state") is None:
                    session["python_state"] = {}
                    if self.storage_path:
                        try:
                            with self._get_db_conn() as conn:
                                cursor = conn.execute(
                                    "SELECT state_data FROM python_state WHERE session_id = ?", 
                                    (session_id,)
                                )
                                row = cursor.fetchone()
                                if row and row["state_data"]:
                                    session["python_state"] = deserialize_python_state(row["state_data"])
                        except Exception as e:
                            print(f"Warning: Could not load python state: {e}")

            return session

    def save_session(self, session_id: Optional[str], serialized_steps: List[Dict], task_preview: str = "New Chat", python_state: Dict = None) -> str:
        """
        Saves or updates a session in both cache and database.
        Accepts optional python_state dict.
        """
        with self.lock:
            if not session_id:
                session_id = str(uuid.uuid4())

            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            session_data = {
                "id": session_id,
                "timestamp": timestamp,
                "preview": task_preview,
                "steps": serialized_steps,
                "python_state": python_state
            }

            # Update cache list logic
            existing_idx = next((i for i, s in enumerate(self.sessions_cache) if s["id"] == session_id), None)
            if existing_idx is not None:
                self.sessions_cache[existing_idx].update(session_data)
                self.sessions_cache.insert(0, self.sessions_cache.pop(existing_idx))
            else:
                self.sessions_cache.insert(0, session_data)

            # Update SQLite
            if self.storage_path:
                try:
                    with self._get_db_conn() as conn:
                        # Upsert Metadata
                        conn.execute("""
                            INSERT INTO sessions (session_id, preview, timestamp, last_updated)
                            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                            ON CONFLICT(session_id) DO UPDATE SET
                                preview=excluded.preview,
                                last_updated=CURRENT_TIMESTAMP
                        """, (session_id, task_preview, timestamp))

                        # Upsert Steps
                        cursor = conn.execute(
                            "SELECT MAX(step_index) as max_idx FROM steps WHERE session_id = ?", 
                            (session_id,)
                        )
                        result = cursor.fetchone()
                        current_db_max_idx = result["max_idx"] if result and result["max_idx"] is not None else -1

                        steps_to_insert = []
                        for idx, step in enumerate(serialized_steps):
                            if idx > current_db_max_idx:
                                steps_to_insert.append((session_id, idx, json.dumps(step)))
                        
                        if steps_to_insert:
                            conn.executemany(
                                "INSERT INTO steps (session_id, step_index, step_data) VALUES (?, ?, ?)",
                                steps_to_insert
                            )
                        
                        # Upsert Python State
                        if python_state:
                            state_blob = serialize_python_state(python_state)
                            if state_blob:
                                conn.execute("""
                                    INSERT INTO python_state (session_id, state_data, last_updated)
                                    VALUES (?, ?, CURRENT_TIMESTAMP)
                                    ON CONFLICT(session_id) DO UPDATE SET
                                        state_data=excluded.state_data,
                                        last_updated=CURRENT_TIMESTAMP
                                """, (session_id, state_blob))

                except Exception as e:
                    raise IOError(f"Could not save session: {e}")

            return session_id
    def rename_session(self, session_id: str, new_name: str) -> bool:
        """ Renames a session in cache and DB. """
        with self.lock:
            # update cache
            session = next((s for s in self.sessions_cache if s["id"] == session_id), None)
            if session:
                session["preview"] = new_name
            else:
                return False

            # update DB
            if self.storage_path:
                try:
                    with self._get_db_conn() as conn:
                        conn.execute(
                            "UPDATE sessions SET preview = ? WHERE session_id = ?",
                            (new_name, session_id)
                        )
                except Exception as e:
                    print(f"Error renaming session in DB: {e}")
                    return False
            
            return True

    def delete_session(self, session_id: str) -> bool:
        """ Deletes a session from cache and DB. """
        with self.lock:
            # update cache
            initial_len = len(self.sessions_cache)
            self.sessions_cache = [s for s in self.sessions_cache if s["id"] != session_id]
            
            if len(self.sessions_cache) == initial_len:
                return False

            # update DB
            if self.storage_path:
                try:
                    with self._get_db_conn() as conn:
                        conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
                        
                except Exception as e:
                    print(f"Error deleting session from DB: {e}")
                    return False
            
            return True