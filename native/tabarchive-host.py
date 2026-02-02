#!/usr/bin/env python3
"""
Tab Archive Native Messaging Host

SQLite + FTS5 backend for high-capacity tab archiving.
Communicates with Firefox extension via length-prefixed JSON over stdin/stdout.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import struct
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

MAX_QUERY_LIMIT = 1000
DEFAULT_QUERY_LIMIT = 100
DEFAULT_EXPORT_CHUNK = 5000
MAX_LOG_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 3

DATA_DIR = Path.home() / ".tabarchive"
DB_PATH = DATA_DIR / "tabs.db"
LOG_PATH = DATA_DIR / "host.log"

# Log to file for debugging (stderr may not be visible from Firefox)
DATA_DIR.mkdir(parents=True, exist_ok=True)

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)
_handler = RotatingFileHandler(
    str(LOG_PATH),
    maxBytes=MAX_LOG_BYTES,
    backupCount=LOG_BACKUP_COUNT,
)
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
log.addHandler(_handler)


def get_connection() -> sqlite3.Connection:
    """Get or create database connection with FTS5 support."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Initialize database schema with FTS5 virtual table."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tabs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            favicon_url TEXT,
            closed_at INTEGER NOT NULL,
            restored_at INTEGER,
            metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tabs_closed_at ON tabs(closed_at);
        CREATE INDEX IF NOT EXISTS idx_tabs_restored_at ON tabs(restored_at);
    """)

    # Check if FTS table exists
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tabs_fts'"
    )
    if cursor.fetchone() is None:
        conn.executescript("""
            CREATE VIRTUAL TABLE tabs_fts USING fts5(
                title,
                url,
                content='tabs',
                content_rowid='id'
            );

            CREATE TRIGGER tabs_ai AFTER INSERT ON tabs BEGIN
                INSERT INTO tabs_fts(rowid, title, url)
                VALUES (new.id, new.title, new.url);
            END;

            CREATE TRIGGER tabs_ad AFTER DELETE ON tabs BEGIN
                INSERT INTO tabs_fts(tabs_fts, rowid, title, url)
                VALUES ('delete', old.id, old.title, old.url);
            END;

            CREATE TRIGGER tabs_au AFTER UPDATE ON tabs BEGIN
                INSERT INTO tabs_fts(tabs_fts, rowid, title, url)
                VALUES ('delete', old.id, old.title, old.url);
                INSERT INTO tabs_fts(rowid, title, url)
                VALUES (new.id, new.title, new.url);
            END;
        """)

        # Populate FTS from existing data
        conn.execute("""
            INSERT INTO tabs_fts(rowid, title, url)
            SELECT id, title, url FROM tabs
        """)

    conn.commit()


def encode_message(message: dict[str, Any]) -> bytes:
    """Encode a message with a little-endian length prefix."""
    encoded = json.dumps(message).encode("utf-8")
    return struct.pack("<I", len(encoded)) + encoded


def read_message_from(stream) -> dict[str, Any] | None:
    """Read a length-prefixed JSON message from a stream."""
    raw_length = stream.read(4)
    if len(raw_length) == 0:
        return None
    if len(raw_length) != 4:
        raise EOFError("Failed to read message length")

    message_length = struct.unpack("<I", raw_length)[0]
    message = stream.read(message_length).decode("utf-8")
    return json.loads(message)


def send_message_to(message: dict[str, Any], stream) -> None:
    """Send a length-prefixed JSON message to a stream."""
    encoded = encode_message(message)
    stream.write(encoded)
    stream.flush()


def read_message() -> dict[str, Any] | None:
    """Read a length-prefixed JSON message from stdin."""
    return read_message_from(sys.stdin.buffer)


def send_message(message: dict[str, Any]) -> None:
    """Send a length-prefixed JSON message to stdout."""
    send_message_to(message, sys.stdout.buffer)


def handle_archive(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Archive a single tab or batch of tabs."""
    tabs = data.get("tabs", [])
    if not tabs and "url" in data:
        tabs = [data]

    archived_count = 0
    for tab in tabs:
        url = tab.get("url")
        if not url:
            continue

        title = tab.get("title", "")
        favicon_url = tab.get("faviconUrl") or tab.get("favicon_url")
        closed_at = tab.get("closedAt") or tab.get("closed_at") or int(time.time() * 1000)
        metadata = tab.get("metadata")

        conn.execute(
            """
            INSERT INTO tabs (url, title, favicon_url, closed_at, metadata)
            VALUES (?, ?, ?, ?, ?)
            """,
            (url, title, favicon_url, closed_at, json.dumps(metadata) if metadata else None),
        )
        archived_count += 1

    conn.commit()
    return {"ok": True, "archived": archived_count}


def handle_search(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Search archived tabs using FTS5."""
    query = data.get("query", "").strip()
    limit = min(data.get("limit", DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT)
    offset = data.get("offset", 0)

    if not query:
        return handle_recent(conn, data)

    # Escape FTS5 special characters and add prefix matching
    safe_query = query.replace('"', '""')
    terms = [re.sub(r'["\*\(\)\{\}\[\]\^~\-\+\:]', '', t) for t in safe_query.split()]
    terms = [t for t in terms if t]

    if not terms:
        return handle_recent(conn, data)

    fts_query = " ".join(f'"{term}"*' for term in terms)

    cursor = conn.execute(
        """
        SELECT t.id, t.url, t.title, t.favicon_url, t.closed_at, t.restored_at, t.metadata
        FROM tabs t
        JOIN tabs_fts fts ON t.id = fts.rowid
        WHERE tabs_fts MATCH ?
        AND t.restored_at IS NULL
        ORDER BY t.closed_at DESC
        LIMIT ? OFFSET ?
        """,
        (fts_query, limit, offset),
    )

    tabs = []
    for row in cursor:
        tabs.append({
            "id": row["id"],
            "url": row["url"],
            "title": row["title"],
            "faviconUrl": row["favicon_url"],
            "closedAt": row["closed_at"],
            "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        })

    return {"ok": True, "tabs": tabs, "count": len(tabs)}


def handle_recent(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Get recently archived tabs."""
    limit = min(data.get("limit", DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT)
    offset = data.get("offset", 0)

    cursor = conn.execute(
        """
        SELECT id, url, title, favicon_url, closed_at, restored_at, metadata
        FROM tabs
        WHERE restored_at IS NULL
        ORDER BY closed_at DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )

    tabs = []
    for row in cursor:
        tabs.append({
            "id": row["id"],
            "url": row["url"],
            "title": row["title"],
            "faviconUrl": row["favicon_url"],
            "closedAt": row["closed_at"],
            "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        })

    return {"ok": True, "tabs": tabs, "count": len(tabs)}


def handle_restore(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Mark tabs as restored and return their URLs."""
    tab_ids = data.get("ids", [])
    if "id" in data:
        tab_ids = [data["id"]]

    if not tab_ids:
        return {"ok": False, "error": "No tab IDs provided"}

    for tid in tab_ids:
        if not isinstance(tid, int):
            return {"ok": False, "error": "Invalid tab ID"}

    placeholders = ",".join("?" * len(tab_ids))

    # Fetch URL(s) before marking as restored
    rows = conn.execute(
        f"SELECT id, url FROM tabs WHERE id IN ({placeholders}) AND restored_at IS NULL",
        tab_ids,
    ).fetchall()

    restored_at = int(time.time() * 1000)

    cursor = conn.execute(
        f"""
        UPDATE tabs
        SET restored_at = ?
        WHERE id IN ({placeholders})
        AND restored_at IS NULL
        """,
        [restored_at] + tab_ids,
    )

    conn.commit()

    # Return single URL for single-tab restore (background.js expects response.url)
    result: dict[str, Any] = {"ok": True, "restored": cursor.rowcount}
    if len(rows) == 1:
        result["url"] = rows[0]["url"]
    elif rows:
        result["urls"] = [row["url"] for row in rows]
    return result


def handle_delete(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Permanently delete archived tabs."""
    tab_ids = data.get("ids", [])
    if "id" in data:
        tab_ids = [data["id"]]

    if not tab_ids:
        return {"ok": False, "error": "No tab IDs provided"}

    for tid in tab_ids:
        if not isinstance(tid, int):
            return {"ok": False, "error": "Invalid tab ID"}

    placeholders = ",".join("?" * len(tab_ids))

    cursor = conn.execute(
        f"DELETE FROM tabs WHERE id IN ({placeholders})",
        tab_ids,
    )

    conn.commit()
    return {"ok": True, "deleted": cursor.rowcount}


def handle_stats(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Get archive statistics."""
    cursor = conn.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN restored_at IS NULL THEN 1 ELSE 0 END) as archived,
            SUM(CASE WHEN restored_at IS NOT NULL THEN 1 ELSE 0 END) as restored,
            MIN(closed_at) as oldest,
            MAX(closed_at) as newest
        FROM tabs
    """)
    row = cursor.fetchone()

    try:
        db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    except OSError:
        db_size = 0

    return {
        "ok": True,
        "totalArchived": row["archived"] or 0,
        "totalRestored": row["restored"] or 0,
        "totalAll": row["total"] or 0,
        "oldestClosedAt": row["oldest"],
        "newestClosedAt": row["newest"],
        "dbPath": str(DB_PATH),
        "dbSizeBytes": db_size,
    }


def handle_export(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Export all archived tabs as JSON."""
    include_restored = data.get("includeRestored", False)
    chunk_size = data.get("chunkSize", DEFAULT_EXPORT_CHUNK)
    offset = data.get("offset", 0)

    if include_restored:
        cursor = conn.execute(
            "SELECT id, url, title, favicon_url, closed_at, restored_at, metadata FROM tabs ORDER BY closed_at DESC LIMIT ? OFFSET ?",
            (chunk_size + 1, offset),
        )
    else:
        cursor = conn.execute(
            "SELECT id, url, title, favicon_url, closed_at, restored_at, metadata FROM tabs WHERE restored_at IS NULL ORDER BY closed_at DESC LIMIT ? OFFSET ?",
            (chunk_size + 1, offset),
        )

    tabs = []
    for row in cursor:
        tabs.append({
            "id": row["id"],
            "url": row["url"],
            "title": row["title"],
            "faviconUrl": row["favicon_url"],
            "closedAt": row["closed_at"],
            "restoredAt": row["restored_at"],
            "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        })

    has_more = len(tabs) > chunk_size
    if has_more:
        tabs = tabs[:chunk_size]

    result: dict[str, Any] = {"ok": True, "tabs": tabs, "count": len(tabs)}
    if has_more:
        result["hasMore"] = True
        result["nextOffset"] = offset + chunk_size

    return result


def handle_import(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Import tabs from JSON."""
    tabs = data.get("tabs", [])
    if not tabs:
        return {"ok": False, "error": "No tabs provided"}

    imported = 0
    for tab in tabs:
        url = tab.get("url")
        if not url:
            continue

        conn.execute(
            """
            INSERT INTO tabs (url, title, favicon_url, closed_at, restored_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                url,
                tab.get("title", ""),
                tab.get("faviconUrl") or tab.get("favicon_url"),
                tab.get("closedAt") or tab.get("closed_at") or int(time.time() * 1000),
                tab.get("restoredAt") or tab.get("restored_at"),
                json.dumps(tab.get("metadata")) if tab.get("metadata") else None,
            ),
        )
        imported += 1

    conn.commit()
    return {"ok": True, "imported": imported}


def handle_vacuum(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Vacuum the database to reclaim space."""
    conn.execute("VACUUM")
    return {"ok": True}


def handle_ping(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    """Health check."""
    return {"ok": True, "version": "1.0.0"}


HANDLERS = {
    "archive": handle_archive,
    "search": handle_search,
    "recent": handle_recent,
    "restore": handle_restore,
    "delete": handle_delete,
    "stats": handle_stats,
    "export": handle_export,
    "import": handle_import,
    "vacuum": handle_vacuum,
    "ping": handle_ping,
}


def main() -> None:
    log.info("Native host starting (pid=%d)", os.getpid())
    try:
        conn = get_connection()
    except Exception:
        log.exception("Failed to initialize database")
        raise
    log.info("Database connection established, entering message loop")

    while True:
        try:
            message = read_message()
            if message is None:
                log.info("Received EOF, shutting down")
                break

            action = message.get("action", "")
            request_id = message.get("requestId")
            log.debug("Received action=%s requestId=%s", action, request_id)
            handler = HANDLERS.get(action)

            if handler:
                response = handler(conn, message)
            else:
                response = {"ok": False, "error": f"Unknown action: {action}"}

            if request_id is not None:
                response["requestId"] = request_id

            send_message(response)
            log.debug("Sent response for action=%s", action)

        except EOFError:
            log.info("EOFError, shutting down")
            break
        except Exception as e:
            log.exception("Error handling message")
            try:
                send_message({"ok": False, "error": str(e)})
            except Exception:
                log.exception("Failed to send error response")
                break

    conn.close()
    log.info("Native host stopped")


if __name__ == "__main__":
    main()
