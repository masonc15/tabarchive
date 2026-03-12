import io
import struct
import importlib.util
from pathlib import Path

import pytest

HOST_PATH = Path(__file__).resolve().parents[1] / 'tabarchive-host.py'

spec = importlib.util.spec_from_file_location('tabarchive_host', HOST_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_send_and_read_roundtrip():
    buffer = io.BytesIO()
    message = {"ok": True, "value": 123}

    module.send_message_to(message, buffer)
    buffer.seek(0)

    read = module.read_message_from(buffer)
    assert read == message


def test_little_endian_length_prefix():
    payload = {"ok": True}
    encoded = module.encode_message(payload)

    length = struct.unpack('<I', encoded[:4])[0]
    assert length == len(encoded) - 4


def test_read_message_rejects_oversized_payload():
    oversized = struct.pack('<I', module.MAX_MESSAGE_BYTES + 1)

    with pytest.raises(ValueError, match="byte limit"):
        module.read_message_from(io.BytesIO(oversized))


def test_send_message_rejects_oversized_response():
    payload = {"ok": True, "value": "x" * (module.MAX_RESPONSE_BYTES + 1)}

    with pytest.raises(ValueError, match="byte limit"):
        module.send_message_to(payload, io.BytesIO())
