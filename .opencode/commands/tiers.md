---
name: tiers
title: Tiers
description: Show active tier configuration for the OpenCode tier router.
usage:
  - /tiers
  - /router
outputs:
  - Mode
  - Enforcement
  - Tiers
  - Preferred tier
---

# /tiers

Show the active routing mode, enforcement policy, tier models, and current session preference.

## Usage

```text
/tiers
```

## Output

- `Mode`: current router mode from `tiers.json`
- `Enforcement`: hard-block/advisory policy
- `Tiers`: @fast, @medium, and @heavy model/cost/cap values
- `Preferred tier`: current session routing preference, when available
