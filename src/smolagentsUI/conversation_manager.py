import warnings
import os
import json
import uuid
import datetime
from typing import List, Dict, Any, Optional

class ConversationManager:
    def __init__(self, storage_path:str=None):
        """
        This class manages conversation sessions, allowing for saving and loading.
        It caches the full history in memory to ensure UI responsiveness.

        Parameters:
        -----------
        storage_path : str 
            Path to the JSON file for storing conversation history. If None, no persistence is used.
        """
        self.storage_path = storage_path
        self.sessions_cache = []
        
        # Ensure the storage file exists
        if self.storage_path and not os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, 'w', encoding='utf-8') as f:
                    json.dump([], f)
            except Exception as e:
                raise IOError(f"Could not create storage file: {e}")
        
        # Load data into memory immediately
        self._load_from_file()

    def _load_from_file(self):
        """ Loads the full conversation history from JSON (disk) into memory. """
        if not self.storage_path or not os.path.exists(self.storage_path):
            self.sessions_cache = []
            return

        try:
            with open(self.storage_path, 'r', encoding='utf-8') as f:
                self.sessions_cache = json.load(f)
        except Exception as e:
            warnings(f"Warning: Could not load storage file: {e}", RuntimeWarning)
            self.sessions_cache = []

    def _save_to_disk(self):
        """ Dumps the in-memory cache to disk. """
        if not self.storage_path:
            return
        try:
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(self.sessions_cache, f, indent=2)
        except Exception as e:
            raise IOError(f"Could not save to storage file: {e}")

    def get_session_summaries(self) -> List[Dict]:
        """ Returns lightweight summaries from memory (Fast). """
        return [{
            "id": s["id"], 
            "timestamp": s["timestamp"], 
            "preview": s.get("preview", "No preview")
        } for s in self.sessions_cache]

    def get_session(self, session_id: str) -> Optional[Dict]:
        """ Returns the full data for a specific session from memory (Fast). """
        return next((s for s in self.sessions_cache if s["id"] == session_id), None)

    def save_session(self, session_id: Optional[str], serialized_steps: List[Dict], task_preview: str = "New Chat") -> str:
        """
        Saves or updates a session in memory and then persists to disk.
        """
        if not session_id:
            session_id = str(uuid.uuid4())

        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Create session object
        session_data = {
            "id": session_id,
            "timestamp": timestamp,
            "preview": task_preview,
            "steps": serialized_steps
        }

        # Update in-memory cache
        existing_idx = next((i for i, s in enumerate(self.sessions_cache) if s["id"] == session_id), None)
        if existing_idx is not None:
            self.sessions_cache[existing_idx] = session_data
        else:
            self.sessions_cache.insert(0, session_data)

        # Persist to disk
        self._save_to_disk()
        return session_id
    
    def rename_session(self, session_id: str, new_name: str) -> bool:
        """ Renames a session in memory (cache) and persists to disk. """
        session = self.get_session(session_id)
        if session:
            session["preview"] = new_name
            self._save_to_disk()
            return True
        return False

    def delete_session(self, session_id: str) -> bool:
        """ Deletes a session from memory and persists to disk. """
        initial_len = len(self.sessions_cache)
        self.sessions_cache = [s for s in self.sessions_cache if s["id"] != session_id]
        
        if len(self.sessions_cache) < initial_len:
            self._save_to_disk()
            return True
        return False