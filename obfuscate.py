#!/usr/bin/env python3
from base64 import b64encode
from pathlib import Path
import sys

KEY = b"vip-1605-door"
CHUNK_SIZE = 96


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 obfuscate.py clear-guests.csv guests.csv", file=sys.stderr)
        raise SystemExit(2)

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    data = source.read_bytes()
    encoded = b64encode(bytes(byte ^ KEY[index % len(KEY)] for index, byte in enumerate(data))).decode()
    chunks = "\n".join(encoded[index:index + CHUNK_SIZE] for index in range(0, len(encoded), CHUNK_SIZE))

    target.write_text(f"XOR_BASE64,v1\n{chunks}\n")


if __name__ == "__main__":
    main()
