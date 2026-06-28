---
name: router
title: Router
description: Enable, disable, or inspect the OpenCode tier router.
usage:
  - /router
  - /router on
  - /router off
outputs:
  - Router status
---

# /router

Control router execution and inspect the current runtime status.

## Usage

```text
/router
/router on
/router off
```

## Output

- Shows `on` or `off` when no argument is provided
- Enables router when `on` is provided
- Disables router when `off` is provided and preserves the response until the next chat message
