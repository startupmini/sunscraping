import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import launcher


def test_mask_key_keeps_only_edges():
    assert launcher.mask_key("abcdefghijklmnop") == "abcd…mnop"
    assert launcher.mask_key("short") == "•" * 8
    assert launcher.mask_key(None) == ""


def test_host_and_origin_are_loopback_only():
    assert launcher.allowed_host("127.0.0.1:5050", 5050)
    assert launcher.allowed_host("localhost:5050", 5050)
    assert not launcher.allowed_host("127.0.0.1:5051", 5050)
    assert not launcher.allowed_host("example.com:5050", 5050)

    assert launcher.allowed_origin("http://127.0.0.1:5050", 5050)
    assert launcher.allowed_origin("http://localhost:5050", 5050)
    assert not launcher.allowed_origin("https://evil.example", 5050)
    assert launcher.allowed_origin(None, 5050)


def test_read_log_tail_returns_last_lines(tmp_path):
    path = tmp_path / "server.log"
    path.write_text("\n".join(f"line {number}" for number in range(10)), encoding="utf-8")

    assert launcher.read_log_tail(path, 3) == ["line 7", "line 8", "line 9"]
    assert launcher.read_log_tail(tmp_path / "missing.log", 3) == []
