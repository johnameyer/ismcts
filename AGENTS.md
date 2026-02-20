# ISMCTS Project Conventions

This document describes the architectural patterns, conventions, and best practices for the ISMCTS (Information Set Monte Carlo Tree Search) implementation.

## Architecture Overview

ISMCTS is organized as a game-agnostic core algorithm with pluggable game adapters:

- **Core Algorithm** (`src/modular/`) - Game-independent MCTS phases
- **Game Adapters** (`src/adapters/`) - Game-specific handlers, action generation, state conversion
- **Strategies** (`src/strategies/`) - Pluggable decision-making strategies
- **Utilities** (`src/utils/`) - Shared infrastructure (state copying, orchestration, etc.)

This separation makes it easy to support new games without changing algorithm code.

## Core Algorithm Phases

The ISMCTS algorithm implements four distinct phases:

1. **Selection** (`modular/selection.ts`) - Traverse tree using UCB1 scores
2. **Expansion** (`modular/expansion.ts`) - Create new nodes from legal actions
3. **Simulation** (`modular/simulation.ts`) - Random playouts to terminal states
4. **Backpropagation** (`modular/backpropagation.ts`) - Update node statistics

Orchestrated by `modular/ismcts.ts`.

## Directory Structure & Responsibilities

```
src/
├── modular/                       # Core MCTS algorithm (game-agnostic)
│   ├── ismcts.ts                  # Main algorithm orchestrator
│   ├── selection.ts               # Selection phase with UCB1
│   ├── expansion.ts               # Expansion phase creating nodes
│   ├── simulation.ts              # Simulation phase (random playouts)
│   ├── backpropagation.ts         # Backpropagation phase
│   ├── ismcts-node.ts             # Tree node data structure
│   ├── ismcts-config.ts           # Configuration parameters
│   ├── ismcts-types.ts            # Core type definitions
│   └── index.ts                   # Module exports
│
├── adapters/                      # Game-specific implementations
│   ├── pocket-tcg/
│   │   ├── handler.ts             # Main entry point (implements GameHandler)
│   │   ├── actions-generator.ts   # Legal action generation
│   │   ├── adapter.ts             # State conversion (game ↔ MCTS)
│   │   ├── ismcts-determinization.ts  # Opponent deck inference
│   │   ├── response-types.ts      # Response message type definitions
│   │   ├── log-utils.ts           # Logging utilities
│   │   └── index.ts               # Adapter exports
│   └── euchre/
│       ├── handler.ts
│       ├── actions-generator.ts
│       └── index.ts
│
├── strategies/                    # Pluggable decision strategies
│   ├── ismcts-decision-strategy.ts    # Full MCTS decision maker
│   ├── random-decision-strategy.ts    # Random baseline
│   ├── event-capturing-strategy.ts    # Testing wrapper (logs events)
│   ├── decision-strategy.ts           # Base interface
│   └── index.ts
│
├── utils/                         # Shared infrastructure
│   ├── driver-orchestrator.ts     # Game driver abstraction (critical)
│   ├── generic-player-view.ts     # Extract player-visible state
│   ├── deep-copy-state.ts         # Deep copy (prevents mutation bugs)
│   ├── driver-types.ts            # Type definitions for drivers
│   ├── waiting-state-utils.ts     # Game state queries
│   ├── tree-debug.ts              # MCTS tree debugging
│   └── ismcts-node-utils.ts       # Node utility functions
│
├── legal-actions-generator.ts     # Base action generation interface
├── game-adapter-config.ts         # Game adapter selection
└── index.ts                       # Public API
```

## Core Concepts

### 1. Game-Agnostic Algorithm

The modular/ folder contains no game-specific code. It works with:
- Generic `GameState` type (game framework's state representation)
- Generic `ResponseMessage` type (game framework's action representation)
- Callbacks for game driver instantiation and state conversion

This allows MCTS to support any game framework without modification.

### 2. State Copying is Critical

All state mutations must work on **deep copies**. Shared state references cause 80% of bugs:
- Selection/expansion/simulation all mutate game state
- Without deep copies, states interfere across iterations
- Results in 20% success rate → 100% after fixing

```typescript
import { deepCopyGameState } from './utils/deep-copy-state.js';
const copiedState = deepCopyGameState(originalState);
```

**Pattern**: Every time game state enters MCTS from adapters, deep copy it immediately.

### 3. Player Visibility

ISMCTS respects what each player can see:

- **HandlerData** - Player-visible game state (what the human sees)
- **GameState** - Full internal state with hidden info
- **Determinization** - Intelligently fills opponent's hidden cards

Handlers receive `HandlerData`. Conversion to full `GameState` happens in adapter.

### 4. Game Driver Orchestration

`driver-orchestrator.ts` abstracts game driver operations:
- Instantiates drivers without direct imports
- Runs simulations to completion (handles internal state transitions)
- Extracts game outcomes and player views
- Validates actions before returning them

**Pattern**: modular/ and adapter code use `driver-orchestrator` functions, never direct driver imports. ESLint enforces this via `@typescript-eslint/no-restricted-imports`.

### 5. Legal Action Generation

Actions must be validated:

1. Generate candidates (creatures, evolutions, attacks, abilities, etc.)
2. Validate each action through game driver simulation
3. Filter by `expectedResponseTypes` if specified
4. Return only actions that pass validation

**Key**: Action generator knows game rules. MCTS just uses what it generates.

### 6. Opponent Determinization

For games with hidden information:

```typescript
// In adapter's ismcts-determinization.ts
const determinizedDeck = determinizeOpponentDeck(gameState, opponentIndex);
// Contains: confirmed cards, probable cards, possible cards
```

Allows MCTS to reason about hidden cards instead of treating them as random.

## Configuration

```typescript
interface ISMCTSConfig {
  iterations: number;              // MCTS iterations per decision (50-1000)
  explorationConstant?: number;    // UCB1 balance (default: 1.414 = √2)
  maxSimulationDepth?: number;     // Prevent runaway simulations
  enableDeterminization?: boolean; // Use opponent deck inference
}
```

Modified in `modular/ismcts-config.ts` per game/use case.

## Game Adapter Implementation Guide

Adding a new game (e.g., "game-x"):

### 1. Create Adapter Directory

```bash
mkdir -p src/adapters/game-x
```

### 2. Implement Required Files

**handler.ts** - Entry point integrating with game framework:
```typescript
export class GameXISMCTSHandler extends GameHandler {
  async handleAction(handlerData): Promise<ResponseMessage> {
    const gameState = this.adapter.toGameState(handlerData);
    const action = await this.strategy.chooseAction(gameState, handlerData);
    return action;
  }
}
```

**actions-generator.ts** - Legal action generation:
```typescript
export function generateLegalActions(
  gameState: GameState,
  handlerData: HandlerData
): ResponseMessage[] {
  // Generate all legal actions for current state
  // Validate each one
  // Return only valid actions
}
```

**adapter.ts** - State conversion:
```typescript
export class GameXAdapter {
  toGameState(handlerData: HandlerData): GameState { }
  toHandlerData(gameState: GameState): HandlerData { }
}
```

**index.ts** - Export public API:
```typescript
export { GameXISMCTSHandler } from './handler.js';
export { GameXAdapter } from './adapter.js';
```

### 3. Register in game-adapter-config.ts

```typescript
export const adapters = {
  'game-x': () => import('./adapters/game-x/index.js'),
};
```

### 4. Test Integration

- Unit tests for action generation
- Integration tests for full game flow
- Verify deep copying prevents state mutation

## Conventions

### Naming

- **action** - response message being evaluated (use in algorithm code)
- **move** - broader context describing a player move
- **ISMCTSNode** - tree nodes in algorithm
- **GameXAdapter** - "GameX" is the game name in PascalCase
- Prefix game-specific code with game name (e.g., `pocket-tcg/`)

### Imports

- Game-specific code: OK to import game framework types
- modular/ code: Import only from modular/, strategies/, utils/ (enforced via ESLint)
- ESLint blocks `@typescript-eslint/no-restricted-imports` for unrelated imports

### Logging

```typescript
import { logger } from './log-utils.js';

logger.debug('[ISMCTS]', 'Phase name', message);
logger.warn('[ISMCTS]', 'Warning context', data);
```

Use `[ISMCTS]` prefix for algorithm messages.

### Types

- Use `type` not `interface` for serialization compatibility
- Avoid `any` types - add definitions instead
- Import types from `ismcts-types.ts` (core algorithm types)
- Import game types from game framework

### Testing

- **Unit tests** (spec/unit/) - Component-level, isolated dependencies
- **Integration tests** (spec/integration/) - Full game flow
- **Helpers** (spec/helpers/) - Shared test utilities
- Use `createWaitingGameStateForMCTS` for valid test state

## Common Patterns

### Pattern: Creating Game Driver for Simulation

```typescript
import { driverOrchestrator } from './utils/driver-orchestrator.js';

const completedState = await driverOrchestrator.simulateUntilCompletion(
  gameState,
  maxDepth
);
```

### Pattern: Extracting Player View

```typescript
import { createGenericPlayerView } from './utils/generic-player-view.js';

const handlerData = createGenericPlayerView(gameState, playerIndex);
```

### Pattern: Validating Actions

```typescript
import { validateActions } from './adapters/game-x/actions-generator.js';

const validActions = await validateActions(
  gameState,
  handlerData,
  candidates
);
```

### Pattern: Deep Copying State

```typescript
import { deepCopyGameState } from './utils/deep-copy-state.js';

const copiedState = deepCopyGameState(originalState);
// Now safe to mutate copiedState without affecting originalState
```

## ESLint Rules

The project enforces modular architecture via ESLint:

```javascript
// In eslint.config.mjs
rules: {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      paths: [
        // modular/ cannot import game frameworks directly
        '@cards-ts/pocket-tcg',
        // adapters cannot import each other
        './adapters/*'
      ]
    }
  ]
}
```

This prevents architectural violations (algorithm depends on adapter, or one adapter depends on another).

## Testing Architecture

### Unit Tests

Test individual components in isolation:
```bash
pnpm test -- --grep "Unit"
```

Patterns:
- Mock game drivers
- Test single functions with known inputs/outputs
- Fast execution

### Integration Tests

Test full game flow with real game drivers:
```bash
pnpm test -- --grep "Integration"
```

Patterns:
- Use `createWaitingGameStateForMCTS` for valid initial state
- Test bot vs bot gameplay
- Test adapter conversion accuracy
- Verify game completion

### Test Helpers

Common utilities in `spec/helpers/`:
- State creation
- Game execution
- Event capture
- Outcome validation

## Known Limitations & TODOs

1. **Select Active Card Phase** - Falls back to random. Needs determinization across turn phases.

2. **Setup Phase** - Falls back to random. Needs game framework integration work.

3. **Simulation Depth** - Currently unlimited. Should respect config limits.

4. **Meta Deck Data** - Determinization infrastructure exists but meta decks not integrated.

## References

- **Game Framework**: [@cards-ts](https://github.com/johnameyer/cards-ts)
- **MCTS**: [Monte Carlo Tree Search on Wikipedia](https://en.wikipedia.org/wiki/Monte_Carlo_tree_search)
- **UCB1**: [Multi-armed Bandit Problem](https://en.wikipedia.org/wiki/Multi-armed_bandit)
- **Information Sets**: [Game Theory](https://en.wikipedia.org/wiki/Information_set_(game_theory))
- **Parent Project**: See `../pocket-tcg/AGENTS.md` for game-specific conventions

