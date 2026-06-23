#!/usr/bin/env python3
"""
build.py — Builds dist/bundle.js from src/main.js
Usage: python3 build.py
"""
import re, os, sys

SRC = 'main.js'
DIST = 'bundle.js'

with open(SRC) as f:
    code = f.read()

# Remove block comments (/** ... */ and /* ... */)
code = re.sub(r'/\*[\s\S]*?\*/', '', code)

# Remove single-line comments only when // is not preceded by : or a word char
# This preserves https:// and similar URLs inside strings
code = re.sub(r'(?<![:\w])//[^\n]*', '', code)

# Remove blank lines
code = re.sub(r'\n[\s\n]*\n', '\n', code)

# Strip leading whitespace per line
lines = [l.strip() for l in code.split('\n') if l.strip()]
code = '\n'.join(lines)

with open(DIST, 'w') as f:
    f.write(code)

size_kb = len(code) / 1024
print(f'✅  Built {DIST}  ({len(lines)} lines, {size_kb:.1f} KB)')
print(f'    Paste contents of {DIST} into the browser console on x.com')
