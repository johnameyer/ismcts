# ISMCTS - Information Set Monte Carlo Tree Search

A flexible, multi-game ISMCTS implementation with support for arbitrary game frameworks. Currently supports Pokemon TCG Pocket and Euchre.

## Features

- ✅ **Multi-game support** - Adapter-based architecture for any game
- ✅ **Strategic action selection** - MCTS beats random play
- ✅ **Game state simulation** - Accurate game-end prediction
- ✅ **Action generation & validation** - Legal move generation per game state
- ✅ **Opponent deck inference** - Smart opponent card determinization
- ✅ **UCB1 exploration** - Configurable exploration/exploitation balance
- ✅ **Deep state copying** - Prevents state mutation bugs
- ✅ **Comprehensive testing** - 50+ automated tests across all phases

## Architecture

### Game-Agnostic Core (modular/)

The ISMCTS algorithm is game-agnostic and implements the four core MCTS phases:

1. **Selection** - Navigate existing tree using UCB1 scores
2. **Expansion** - Create new nodes from legal actions
3. **Simulation** - Run random playouts to terminal states
4. **Backpropagation** - Update node statistics with outcome

### Game Adapters (adapters/)

Each game has an adapter that provides:
- `handler.ts` - Entry point for game framework integration
- `actions-generator.ts` - Legal action generation per game rules
- `adapter.ts` - State conversion between game framework and ISMCTS
- Game-specific utilities (determinization, logging, etc.)

### Decision Strategies (strategies/)

Pluggable strategies for choosing bot actions:
- `ISMCTSDecisionStrategy` - Full MCTS computation
- `RandomDecisionStrategy` - Random fallback
- `EventCapturingStrategy` - Testing wrapper for event logging

## Directory Structure

```
ismcts/
├── src/
│   ├── adapters/                # Game-specific adapters
│   │   ├── pocket-tcg/          # Pokemon TCG Pocket adapter
│   │   │   ├── handler.ts       # Main handler entry point
│   │   │   ├── actions-generator.ts  # Legal action generation
│   │   │   ├── adapter.ts       # Game state adapter
│   │   │   └── ismcts-determinization.ts  # Opponent deck inference
│   │   └── euchre/              # Euchre game adapter
│   ├── modular/                 # Core ISMCTS algorithm (game-agnostic)
│   │   ├── ismcts.ts            # Main algorithm orchestrator
│   │   ├── selection.ts         # UCB1-based selection phase
│   │   ├── expansion.ts         # Node expansion phase
│   │   ├── simulation.ts        # Random playout phase
│   │   ├── backpropagation.ts   # Statistics update phase
│   │   ├── ismcts-node.ts       # Tree node structure
│   │   ├── ismcts-config.ts     # Configuration parameters
│   │   └── ismcts-types.ts      # Core type definitions
│   ├── strategies/              # Game handlers and decision strategies
│   │   ├── ismcts-decision-strategy.ts  # ISMCTS strategy
│   │   ├── random-decision-strategy.ts  # Random baseline
│   │   ├── event-capturing-strategy.ts  # Testing utility
│   │   └── decision-strategy.ts  # Base interface
│   ├── utils/                   # Shared utilities
│   │   ├── driver-orchestrator.ts  # Game driver abstraction
│   │   ├── generic-player-view.ts  # State view extraction
│   │   ├── deep-copy-state.ts     # Critical: state mutation prevention
│   │   └── tree-debug.ts        # MCTS tree debugging
│   └── index.ts                 # Public API exports
├── spec/                        # Automated tests
│   ├── integration/             # Full game flow tests
│   ├── unit/                    # Component unit tests
│   ├── helpers/                 # Test utilities
│   └── README.md                # Test documentation
└── package.json                 # Dependencies and scripts
```

## Core Concepts

### 1. Game State Management

All game state mutations use **deep copies** to prevent shared state reference bugs that cause 80% of action generation failures. Critical for MCTS correctness.

```typescript
import { deepCopyGameState } from './utils/deep-copy-state.js';
const copiedState = deepCopyGameState(originalState);
```

### 2. Player Visibility

ISMCTS respects what each player can see:
- `HandlerData` - Player-visible game state
- `GameState` - Full internal game state with hidden info
- Determinization fills hidden opponent cards intelligently

### 3. Legal Action Generation

Actions go through strict validation:
1. Generate action candidates (creatures, evolves, attacks, etc.)
2. Validate each candidate using game driver simulation
3. Filter by response type requirements
4. Return only legal actions

### 4. UCB1 Scoring

Balances exploration vs exploitation in tree traversal:
- Formula: `mean_value + C * sqrt(ln(parent_visits) / child_visits)`
- Configurable exploration constant (default: √2 ≈ 1.414)
- Tuned via `ISMCTSConfig.explorationConstant`

### 5. Opponent Determinization

Infers opponent's hidden deck based on visible play:
- **Confirmed cards** - Known to be in opponent deck (accounting for 2-card limits)
- **Probable cards** - Inferred from evolution chains and meta patterns
- **Possible cards** - All potential cards from matching meta decks

## Integration

### Pokemon TCG Pocket

```typescript
import { ISMCTSBotHandler } from '@ismcts/adapters/pocket-tcg';

const handler = new ISMCTSBotHandler(
  playerIndex,
  cardRepository,
  { iterations: 100, explorationConstant: 1.414 }
);
```

### Euchre

```typescript
import { EuchreISMCTSHandler } from '@ismcts/adapters/euchre';

const handler = new EuchreISMCTSHandler(playerIndex, config);
```

## Configuration

```typescript
interface ISMCTSConfig {
  iterations: number;           // MCTS iterations per decision (50-1000)
  explorationConstant: number;  // UCB1 balance (default: 1.414 = √2)
  maxSimulationDepth?: number;  // Prevent infinite simulations
  enableDeterminization?: boolean; // Opponent deck inference
}
```

Modify in `modular/ismcts-config.ts` to adjust bot strength.

## Testing

### Run All Tests

```bash
cd ismcts && pnpm test
```

### Run by Category

```bash
pnpm test -- --grep "Integration"
pnpm test -- --grep "Unit"
pnpm test -- --grep "Binary Choice"
```

### Test Coverage

- **Integration tests** (spec/integration/) - Full game flow
- **Unit tests** (spec/unit/) - Component-level testing
- **Helpers** (spec/helpers/) - Shared test utilities

## References

- **Game Framework**: [@cards-ts](https://github.com/johnameyer/cards-ts) - Core game engine
- **MCTS Algorithm**: [Monte Carlo Tree Search](https://en.wikipedia.org/wiki/Monte_Carlo_tree_search)
- **UCB1**: [Upper Confidence Bounds applied to Trees](https://en.wikipedia.org/wiki/Monte_Carlo_tree_search)
- **Information Sets**: [Game Theory](https://en.wikipedia.org/wiki/Information_set_(game_theory))

## See Also

- `AGENTS.md` - Architectural patterns and conventions
- `spec/README.md` - Test organization and coverage

