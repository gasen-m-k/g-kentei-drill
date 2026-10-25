"""data/src/*.json をまとめて data/questions.json を作る。

- 問題IDの重複、選択肢の数、正解番号などをチェックする
- 元データでは正解を先頭に書いてよい。出力時に問題IDから決まる順序で
  選択肢を並べ替えるので、正解の位置は毎回同じにならず、再ビルドしても変わらない
"""
import hashlib
import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "src"
OUT = ROOT / "data" / "questions.json"


def main() -> int:
    cats, questions, errors = [], [], []
    seen = set()
    for i, path in enumerate(sorted(SRC.glob("*.json")), start=1):
        doc = json.loads(path.read_text(encoding="utf-8"))
        cat_id = f"c{i:02d}"
        cats.append({"id": cat_id, "name": doc["cat"]})
        for item in doc["items"]:
            qid = item["id"]
            where = f"{path.name}:{qid}"
            if qid in seen:
                errors.append(f"{where} IDが重複")
            seen.add(qid)
            if not qid.startswith(cat_id + "-"):
                errors.append(f"{where} IDの分野番号がファイル順と合わない（{cat_id}）")
            for key in ("s", "q", "e"):
                if not item.get(key, "").strip():
                    errors.append(f"{where} {key} が空")
            choices = item.get("c", [])
            if len(choices) != 4:
                errors.append(f"{where} 選択肢が4つでない")
            if len(set(choices)) != len(choices):
                errors.append(f"{where} 選択肢が重複")
            a = item.get("a")
            if not isinstance(a, int) or not 0 <= a < len(choices):
                errors.append(f"{where} 正解番号が不正")
                continue
            order = list(range(len(choices)))
            seed = int(hashlib.sha256(qid.encode()).hexdigest(), 16)
            random.Random(seed).shuffle(order)
            new_choices = [choices[j] for j in order]
            questions.append({
                "id": qid,
                "cat": cat_id,
                "s": item["s"],
                "q": item["q"],
                "c": new_choices,
                "a": order.index(a),
                "e": item["e"],
            })

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    body = {"cats": cats, "q": questions}
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:10]
    body = {"version": digest, **body}
    OUT.write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    per_cat = Counter(q["cat"] for q in questions)
    names = {c["id"]: c["name"] for c in cats}
    for cid in sorted(per_cat):
        print(f"{cid} {names[cid]}: {per_cat[cid]}問")
    print(f"合計 {len(questions)}問 / version {digest}")
    print("正解の位置の分布:", dict(sorted(Counter(q['a'] for q in questions).items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
