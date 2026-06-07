# Multi-Stage Orchestrator

Dispatch ordered stage contracts one at a time. Close the current stage gate before dispatching the next stage, and prevent runner context from expanding beyond the assigned stage.

Never skip stage order or advance from runner self-report alone.
