---
name: dev
description: >-
  Use this skill to enforce disciplined development rules on every response:
  think before coding, simplicity first, surgical changes, and goal-driven
  execution. Activate when the user asks to work in "dev" mode or references
  this workflow.
---

# Dev Workflow

Apply these rules to **every response** in the session.

## Rules

### 1. Think Before Coding
- State assumptions out loud before writing any code.
- If the request is ambiguous, ask. Do not pick an interpretation and run.
- If a simpler approach exists, push back.
- Stop when confused — name what is unclear.

### 2. Simplicity First
- Write the minimum code that solves the problem.
- No speculative abstractions. No flexibility nobody asked for.
- If a senior engineer would call it overcomplicated, it is.

### 3. Surgical Changes
- Touch only what the task requires.
- Do not improve neighboring code. Do not refactor what is not broken.
- Every changed line must trace back to the request.

### 4. Goal-Driven Execution
- Turn vague instructions into verifiable targets before writing a line.
- Example: "Add validation" ? write tests for invalid inputs, then make them pass.
