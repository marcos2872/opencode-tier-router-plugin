---
name: budget
title: Budget
description: List routing modes or switch the active budget/quality/deep mode.
usage:
  - /budget
  - /budget <normal|budget|quality|deep>
outputs:
  - Current mode
  - Available modes
  - Switched mode confirmation
---

# /budget

Switch the router mode and persist the active mode in `tiers.json`.

## Usage

```text
/budget
/budget <normal|budget|quality|deep>
```

## Output

- With no argument: list available modes and highlight the active mode
- With argument: switch to the requested mode and confirm in the session
- Invalid mode: list available modes and keep the current mode
