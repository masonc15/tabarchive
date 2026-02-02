import io
import struct
import importlib.util
from pathlib import Path

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
