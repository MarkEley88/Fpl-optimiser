# Exact optimiser branch

This branch starts from the current production-era optimiser without changing `main`.

## Objective

Replace the current bounded beam search with an exact state-space solver that can evaluate transfer timing and combinations without silently discarding a potentially optimal route.

## State definition

A state is canonicalised by:

- Gameweek
- 15 player IDs
- Bank
- Free transfers
- Chip availability/usage

Transfer order is not itself part of the state. Different transfer sequences that arrive at the same canonical state are therefore collapsed.

## Search design

1. Generate every legal transfer from the current state.
2. Continue transfers within the same Gameweek so funding transfers can unlock initially unaffordable players.
3. Generate the Hold state.
4. Apply FPL hit costs to transfers beyond the available free transfers.
5. Move the resulting canonical states to the next Gameweek.
6. Memoise states so equivalent paths are evaluated once.
7. Use an optimistic mathematical upper bound only when it is guaranteed not to remove the true optimum.
8. Keep the existing beam engine available as the production fallback until the exact solver has been benchmarked.

## Important constraint

The solver must never use player price as a quality signal. Price/bank/selling value are eligibility constraints only.

## Production safety

The existing `main` branch is untouched. This branch is experimental until the exact solver is benchmarked against the existing engine and verified for legal FPL state transitions.
