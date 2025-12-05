import os
import json
import uuid
import datetime
from typing import List, Dict, Any, Optional

class ConversationManager:
    def __init__(self, storage_path:str=None):
        """
        This class manages conversation sessions, allowing for saving, loading.

        Parameters:
        -----------
        storage_path : str 
            Path to the JSON file for storing conversation history. If None, no persistence is used.
        """
        self.storage_path = storage_path
        # Ensure the storage file exists
        if self.storage_path and not os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, 'w', encoding='utf-8') as f:
                    json.dump([], f)
            except Exception as e:
                raise IOError(f"Could not create storage file: {e}")

    def _load_conversation(self) -> List[Dict]:
        if not self.storage_path or not os.path.exists(self.storage_path):
            return []
        try:
            with open(self.storage_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            raise IOError(f"Could not load storage file: {e}")

    def _save_conversation(self, sessions: List[Dict]):
        if not self.storage_path:
            return
        try:
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(sessions, f, indent=2)
        except Exception as e:
            raise IOError(f"Could not save to storage file: {e}")

    def get_session_summaries(self) -> List[Dict]:
        """ Returns lightweight summaries for the sidebar list. """
        sessions = self._load_conversation()
        return [{
            "id": s["id"], 
            "timestamp": s["timestamp"], 
            "preview": s.get("preview", "No preview")
        } for s in sessions]

    def get_session(self, session_id: str) -> Optional[Dict]:
        """ Returns the full data for a specific session. """
        sessions = self._load_conversation()
        return next((s for s in sessions if s["id"] == session_id), None)

    def save_session(self, session_id: Optional[str], serialized_steps: List[Dict], task_preview: str = "New Chat") -> str:
        """
        Saves or updates a session. 
        Returns the session_id (creates a new one if None provided).

        Parameters:
        -----------
        session_id : Optional[str]
            The ID of the session to update. If None, a new session is created.
        serialized_steps : List[Dict]
            The serialized steps of the conversation to save.
        task_preview : str
            A short preview text for the session.
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

        sessions = self._load_conversation()
        
        # Update existing or insert new
        existing_idx = next((i for i, s in enumerate(sessions) if s["id"] == session_id), None)
        if existing_idx is not None:
            sessions[existing_idx] = session_data
        else:
            sessions.insert(0, session_data)

        self._save_conversation(sessions)
        return session_id