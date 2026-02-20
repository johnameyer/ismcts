import { HandlerData } from '@cards-ts/pocket-tcg/dist/game-handler.js';
import { CardRepository } from '@cards-ts/pocket-tcg/dist/repository/card-repository.js';
import { ControllerState } from '@cards-ts/core';
import { Controllers } from '@cards-ts/pocket-tcg/dist/controllers/controllers.js';
import { ResponseMessage } from '@cards-ts/pocket-tcg/dist/messages/response-message.js';
import { getCurrentTemplateId, getFieldInstanceId } from '@cards-ts/pocket-tcg/dist/utils/field-card-utils.js';
import { ISMCTSNode } from '../../ismcts-node.js';

export function logGameState(cardRepository: CardRepository, state: ControllerState<Controllers>) {
    console.log(`Final points: [${state.points}]`);
    
    console.log('=== Final Game State ===');
    console.log(`Points: Player 0: ${state.points[0]}, Player 1: ${state.points[1]}`);
    for (let player = 0; player < 2; player++) {
        console.log(`Player ${player}:`);
        console.log(`  Deck: ${state.deck?.[player]?.length || 0} cards remaining`);
        const creatures = state.field?.creatures?.[player] || [];
        creatures.forEach((creature, index) => {
            if (creature) {
                const templateId = getCurrentTemplateId(creature);
                const instanceId = getFieldInstanceId(creature);
                const maxHp = cardRepository.getCreature(templateId).maxHp;
                const currentHp = maxHp - (creature.damageTaken || 0);
                const currentEnergy = state.energy.attachedEnergyByInstance[instanceId];
                console.log(`  ${index === 0 ? 'Active' : `Bench ${index}`}: ${templateId} (${currentHp}/${maxHp} HP with ${energyDictionaryToString(currentEnergy)})`);
            }
        });
        
        const hand = state.hand?.[player] || [];
        console.log(`  Hand (${hand.length} cards): ${hand.map(card => card.templateId).join(', ')}`);
    }
}

export function logHandlerState(cardRepository: CardRepository, state: HandlerData) {
    console.log(`Final points: [${state.points}]`);
    
    console.log('=== Final Game State ===');
    console.log(`Points: Player 0: ${state.points[0]}, Player 1: ${state.points[1]}`);
    for (let player = 0; player < 2; player++) {
        console.log(`Player ${player}:`);
        // console.log(`  Deck: ${state.deck?.[player]?.length || 0} cards remaining`);
        const creatures = state.field?.creatures?.[player] || [];
        creatures.forEach((creature, index: number) => {
            if (creature) {
                const templateId = getCurrentTemplateId(creature);
                const instanceId = getFieldInstanceId(creature);
                const maxHp = cardRepository.getCreature(templateId).maxHp;
                const currentHp = maxHp - (creature.damageTaken || 0);
                const currentEnergy = state.energy.attachedEnergyByInstance[instanceId];
                console.log(`  ${index === 0 ? 'Active' : `Bench ${index}`}: ${templateId} (${currentHp}/${maxHp} HP with ${energyDictionaryToString(currentEnergy)})`);
            }
        });
    }

    const playerIndex = state.players.position;

    const hand = state.hand;
    console.log(`  Player ${playerIndex} Hand (${hand.length} cards): ${hand.map(card => card.templateId).join(', ')}`);
}

export function responseMessageToString(message: ResponseMessage | undefined): string {
    if (undefined === message) {
        return 'undefined';
    }

    if (message.type === 'use-ability-response') {
        return 'Use ability' + message.abilityIndex;
    } else if (message.type === 'play-card-response') {
        return `Play ${message.templateId} to ${message.targetPlayerId} ${message.targetFieldIndex}`;
    } else if (message.type === 'evolve-response') {
        return `Evolve ${message.position} to ${message.evolutionId}`;
    } else if (message.type === 'attack-response') {
        return `Attack with ${message.attackIndex}`;
    } else if (message.type === 'end-turn-response') {
        return 'End turn';
    } else if (message.type === 'attach-energy-response') {
        return 'Attach energy ' + message.fieldPosition;
    } else if (message.type === 'select-active-card-response') {
        return 'Select active card ' + message.benchIndex;
    } else if (message.type === 'select-target-response') {
        return 'Select player ' + message.targetPlayerId + ' target index ' + message.targetCreatureIndex;
    } else if (message.type === 'retreat-response') {
        return `Retreat to ${message.benchIndex}`;
    } 
    return 'Logging not enabled';
    
}

function energyDictionaryToString(energyDictionary: Record<string, number> | undefined): string {
    const energyEntries = Object.entries(energyDictionary || {});
    return energyEntries.map(([ key, value ]) => `${key}: ${value}`).join(', ');
}

export function logMCTSTree(node: ISMCTSNode<ResponseMessage>, depth: number = 0, maxDepth: number = 3): void {
    if (depth > maxDepth) {
        return; 
    }
    
    const indent = '  '.repeat(depth);
    const avgScore = node.visits > 0 ? (node.totalReward / node.visits).toFixed(3) : 'N/A';
    const actionStr = node.lastAction ? responseMessageToString(node.lastAction) : 'ROOT';
    
    console.log(`${indent}[${node.visits} visits, avg=${avgScore}] ${actionStr}`);
    
    node.children?.forEach((child: ISMCTSNode<ResponseMessage>) => {
        logMCTSTree(child, depth + 1, maxDepth);
    });
}
