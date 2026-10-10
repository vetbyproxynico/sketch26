#!/usr/bin/env python3
"""Token use by model for a time window, from this session's transcripts (main thread and subagents).
Usage: usage.py <from ISO UTC> <to ISO UTC>
Prices are assumptions (USD per million tokens), stated in the output."""
import json, glob, sys, os
from collections import defaultdict
ROOT = '/root/.claude/projects/-home-claude-sketch26'
start, end = sys.argv[1], sys.argv[2]
# Assumed list prices, USD per million tokens: (input, output). Cache write 1.25x input, cache read 0.1x input.
PRICES = {'opus': (5.0, 25.0), 'sonnet': (3.0, 15.0), 'haiku': (1.0, 5.0)}
def tier(model):
    m = (model or '').lower()
    for key in PRICES:
        if key in m: return key
    return None
per = {}
files = glob.glob(f'{ROOT}/*.jsonl') + glob.glob(f'{ROOT}/*/subagents/**/*.jsonl', recursive=True) + glob.glob(f'{ROOT}/*/subagents/*.jsonl')
for path in set(files):
    with open(path, errors='replace') as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            ts = d.get('timestamp') or ''
            if not (start <= ts < end): continue
            m = d.get('message') if isinstance(d.get('message'), dict) else None
            u = m.get('usage') if m else None
            if not u: continue
            key = (path, m.get('id') or d.get('requestId') or d.get('uuid'))
            row = per.setdefault(key, {'model': m.get('model') or 'unknown', 'in': 0, 'out': 0, 'cw': 0, 'cr': 0})
            # A reply is written to the transcript in several records; the largest figure is the final one.
            row['in'] = max(row['in'], u.get('input_tokens') or 0)
            row['out'] = max(row['out'], u.get('output_tokens') or 0)
            row['cw'] = max(row['cw'], u.get('cache_creation_input_tokens') or 0)
            row['cr'] = max(row['cr'], u.get('cache_read_input_tokens') or 0)
agg = defaultdict(lambda: defaultdict(int))
for row in per.values():
    a = agg[row['model']]
    a['calls'] += 1
    for k in ('in', 'out', 'cw', 'cr'): a[k] += row[k]
total = 0.0
print(f'window {start} to {end} UTC; files read {len(set(files))}')
for model, a in sorted(agg.items()):
    t = tier(model)
    cost = None
    if t:
        pi, po = PRICES[t]
        cost = (a['in'] * pi + a['cw'] * pi * 1.25 + a['cr'] * pi * 0.1 + a['out'] * po) / 1e6
        total += cost
    print(f"{model}: calls {a['calls']}, fresh input {a['in']:,}, cache write {a['cw']:,}, cache read {a['cr']:,}, output {a['out']:,}, cost ${cost:.2f}" if cost is not None else f"{model}: calls {a['calls']} (no price)")
print(f'total ${total:.2f}')
