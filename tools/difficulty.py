"""Suggested difficulty (1 easiest - 4 hardest) for every word in the three banks, from how common the word is in English
(wordfreq Zipf scale, plus its inflected forms so 'abated' counts for 'abate').
Usage: python3 tools/difficulty.py <source data folder> <out.json>      (pip install wordfreq)
The output lists the words in plain text, so it is not committed; tools/build.js reads it via DIFF_FILE=<out.json>."""
import json, re, sys, glob, os
from wordfreq import zipf_frequency
SRC, OUT = sys.argv[1], sys.argv[2]
CUTS = [3.55, 2.95, 2.35]            # Zipf >= 3.55 -> 1, >= 2.95 -> 2, >= 2.35 -> 3, else 4
dec = json.JSONDecoder()
words = set()
for f in glob.glob(f'{SRC}/unit*-data.js') + glob.glob(f'{SRC}/hot-unit*-data.js') + glob.glob(f'{SRC}/mk-unit*-data.js'):
    s = open(f, encoding='utf-8').read(); a = 'window.FLASHCARD_UNITS = '
    for u in dec.raw_decode(s, s.index(a) + len(a))[0].values():
        for c in u['cards']: words.add(re.sub(r'\s*\(.*?\)\s*', ' ', c['word']).strip().lower())
def forms(w):
    out = {w}
    if ' ' in w or '-' in w: return out
    out |= {w + 's', w + 'ed', w + 'ing', w + 'ly'}
    if w.endswith('e'): out |= {w + 'd', w[:-1] + 'ing'}
    if re.search(r'[^aeiou]y$', w): out |= {w[:-1] + 'ies', w[:-1] + 'ied', w[:-1] + 'ily'}
    return out
res = {}
for w in sorted(words):
    z = max(zipf_frequency(f, 'en') for f in forms(w))
    res[w] = [1 + sum(z < c for c in CUTS), round(z, 2)]
json.dump(res, open(OUT, 'w'), ensure_ascii=False)
if __name__ == '__main__':
    import collections, random
    cnt = collections.Counter(v[0] for v in res.values()); print(len(res), dict(sorted(cnt.items())))
    random.seed(7)
    for L in (1, 2, 3, 4):
        ws = [w for w, v in res.items() if v[0] == L]; print(L, ', '.join(random.sample(ws, min(28, len(ws)))))
