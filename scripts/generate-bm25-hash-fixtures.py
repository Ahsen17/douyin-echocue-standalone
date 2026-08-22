#!/usr/bin/env python3
"""Generate the cross-language token-hash fixture for Bm25TextPipeline.

Each token is hashed as abs(MurmurHash3_x86_32(UTF-8 bytes, seed=0)) using the
reference `mmh3` package. The TypeScript side (`src/main/retrieval/token-id.ts`)
must produce the identical value; `tests/contract/T-RET-001-*.test.ts` asserts
the match. Run from the repo root:

    python3 scripts/generate-bm25-hash-fixtures.py > docs/06-data-interface/fixtures/bm25-token-hash-fixtures-v1.json

Requires: python3 + mmh3 (pip install mmh3).
"""

import importlib.metadata
import json

import mmh3

TOKENS = [
    # Chinese words
    "主播", "状态", "今天", "真好", "技术", "厉害", "共和国", "武汉",
    "长江大桥", "笑死", "中华人民共和国", "今天状态真好",
    # ASCII
    "AI", "hello", "test", "bm25",
    # raw hash >= 2^31 to exercise the signed int32 conversion branch
    "aaad",
    # emoji
    "😊", "🚀", "❤️", "🔥",
    # mixed
    "AI技术", "主播😊",
]


def main() -> None:
    try:
        mmh3_version = importlib.metadata.version("mmh3")
    except importlib.metadata.PackageNotFoundError:
        mmh3_version = "unknown"
    rows = []
    for token in TOKENS:
        raw = token.encode("utf-8")
        rows.append(
            {
                "token": token,
                "utf8hex": raw.hex(),
                "pythonIndex": abs(mmh3.hash(raw)),
            }
        )
    out = {
        "version": "1",
        "algorithm": "abs(MurmurHash3_x86_32(UTF-8, seed=0))",
        "pythonPackage": f"mmh3 {mmh3_version}",
        "tokens": rows,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
