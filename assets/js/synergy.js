/**
 * Card synergy analysis and relationship calculations
 * @module Synergy
 */

import { logger } from './utils/logger.js';
import { AppError, ErrorTypes } from './utils/errorHandler.js';

/**
 * Calculate card synergy metrics based on co-occurrence in decks
 */
export class SynergyAnalyzer {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Calculate synergy between two cards based on co-occurrence
   * @param {string} cardA - First card name
   * @param {string} cardB - Second card name
   * @param {Array} decks - Array of deck objects
   * @returns {Object} Synergy metrics
   */
  calculatePairSynergy(cardA, cardB, decks) {
    if (!cardA || !cardB || cardA === cardB) {
      return { strength: 0, confidence: 0 };
    }

    const totalDecks = decks.length;
    let decksWithA = 0;
    let decksWithB = 0;
    let decksWithBoth = 0;

    // Count occurrences
    decks.forEach(deck => {
      const cardNames = deck.cards.map(c => c.name);
      const hasA = cardNames.includes(cardA);
      const hasB = cardNames.includes(cardB);

      if (hasA) {decksWithA++;}
      if (hasB) {decksWithB++;}
      if (hasA && hasB) {decksWithBoth++;}
    });

    if (decksWithA === 0 || decksWithB === 0) {
      return { strength: 0, confidence: 0, cooccurrence: 0, expected: 0 };
    }

    // Calculate synergy metrics
    const cooccurrenceRate = decksWithBoth / totalDecks;
    const expectedRate = (decksWithA / totalDecks) * (decksWithB / totalDecks);
    const lift = expectedRate > 0 ? cooccurrenceRate / expectedRate : 0;

    // Confidence: how often B appears when A is present
    const confidence = decksWithBoth / decksWithA;

    // Strength combines lift and confidence
    const strength = Math.min(lift, 5) * confidence;

    return {
      strength,
      confidence,
      cooccurrence: cooccurrenceRate,
      expected: expectedRate,
      lift,
      decksWithBoth,
      decksWithA,
      decksWithB,
      totalDecks
    };
  }

  /**
   * Build comprehensive synergy network for all cards in tournament
   * @param {Array} decks - Tournament deck data
   * @param {number} minOccurrence - Minimum card occurrences to include
   * @param {number} minSynergy - Minimum synergy strength threshold
   * @returns {Object} Network data with nodes and edges
   */
  buildSynergyNetwork(decks, minOccurrence = 5, minSynergy = 0.1) {
    logger.debug(`Building synergy network with ${decks.length} decks`);

    // Extract all unique cards with occurrence counts
    const cardOccurrences = new Map();
    decks.forEach(deck => {
      const cardNames = new Set(deck.cards.map(c => c.name));
      cardNames.forEach(cardName => {
        cardOccurrences.set(cardName, (cardOccurrences.get(cardName) || 0) + 1);
      });
    });

    // Filter cards by minimum occurrence
    const significantCards = Array.from(cardOccurrences.entries())
      .filter(([, count]) => count >= minOccurrence)
      .map(([card, count]) => ({ name: card, occurrence: count }))
      .sort((a, b) => b.occurrence - a.occurrence);

    logger.debug(`Found ${significantCards.length} significant cards`);

    // Build nodes
    const nodes = significantCards.map((card) => ({
      id: card.name,
      name: card.name,
      occurrence: card.occurrence,
      popularity: card.occurrence / decks.length,
      group: this._categorizeCard(card.name)
    }));

    // Calculate synergies between all card pairs
    const edges = [];
    for (let i = 0; i < significantCards.length; i++) {
      for (let j = i + 1; j < significantCards.length; j++) {
        const cardA = significantCards[i].name;
        const cardB = significantCards[j].name;

        const synergy = this.calculatePairSynergy(cardA, cardB, decks);

        if (synergy.strength >= minSynergy) {
          edges.push({
            source: cardA,
            target: cardB,
            strength: synergy.strength,
            confidence: synergy.confidence,
            lift: synergy.lift,
            cooccurrence: synergy.cooccurrence,
            decksWithBoth: synergy.decksWithBoth
          });
        }
      }
    }

    // Sort edges by strength
    edges.sort((a, b) => b.strength - a.strength);

    logger.info(`Built synergy network: ${nodes.length} nodes, ${edges.length} edges`);

    return {
      nodes,
      edges,
      metadata: {
        totalDecks: decks.length,
        totalCards: cardOccurrences.size,
        significantCards: significantCards.length,
        minOccurrence,
        minSynergy,
        generatedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Find cards that commonly appear with a specific card
   * @param {string} targetCard - The card to find synergies for
   * @param {Array} decks - Tournament deck data
   * @param {number} limit - Maximum number of results
   * @returns {Array} Sorted array of synergy relationships
   */
  findCardSynergies(targetCard, decks, limit = 20) {
    const allCards = new Set();
    decks.forEach(deck => {
      deck.cards.forEach(card => allCards.add(card.name));
    });

    const synergies = [];
    for (const cardName of allCards) {
      if (cardName === targetCard) {continue;}

      const synergy = this.calculatePairSynergy(targetCard, cardName, decks);
      if (synergy.strength > 0) {
        synergies.push({
          card: cardName,
          ...synergy
        });
      }
    }

    // Sort by strength and limit results
    return synergies
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }

  /**
   * Analyze synergy trends over multiple tournaments
   * @param {Object} tournamentData - Map of tournament names to deck arrays
   * @param {string} cardA - First card
   * @param {string} cardB - Second card
   * @returns {Array} Time series of synergy data
   */
  analyzeSynergyTrends(tournamentData, cardA, cardB) {
    const trends = [];

    Object.entries(tournamentData).forEach(([tournament, decks]) => {
      const synergy = this.calculatePairSynergy(cardA, cardB, decks);
      trends.push({
        tournament,
        date: this._extractDateFromTournament(tournament),
        ...synergy
      });
    });

    return trends.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  /**
   * Find strongest synergy clusters in the network
   * @param {Object} network - Network data from buildSynergyNetwork
   * @param {number} minClusterSize - Minimum cluster size
   * @returns {Array} Array of card clusters
   */
  findSynergyClusters(network, minClusterSize = 3) {
    const clusters = [];
    const visited = new Set();

    network.nodes.forEach(node => {
      if (visited.has(node.id)) {return;}

      const cluster = this._findConnectedCards(node.id, network, visited, minClusterSize);
      if (cluster.length >= minClusterSize) {
        clusters.push({
          cards: cluster,
          strength: this._calculateClusterStrength(cluster, network),
          size: cluster.length
        });
      }
    });

    return clusters.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Generate export data for synergy analysis
   * @param {Object} network - Network data
   * @param {string} format - Export format ('csv', 'json')
   * @returns {string} Formatted export data
   */
  exportSynergyData(network, format = 'csv') {
    switch (format.toLowerCase()) {
    case 'csv':
      return this._exportToCSV(network);
    case 'json':
      return JSON.stringify(network, null, 2);
    default:
      throw new AppError(`Unsupported export format: ${format}`, ErrorTypes.VALIDATION);
    }
  }

  // Private helper methods
  _categorizeCard(cardName) {
    // Basic categorization logic - can be enhanced
    if (cardName.includes(' ex') || cardName.includes(' V') || cardName.includes('VSTAR')) {
      return 'pokemon-main';
    } else if (cardName.includes('Professor') || cardName.includes('Boss\'s Orders')) {
      return 'trainer';
    } else if (cardName.includes('Energy')) {
      return 'energy';
    }
    return 'pokemon';
  }

  _extractDateFromTournament(tournament) {
    // Extract date from tournament name like "2025-08-15, World Championships 2025"
    const match = tournament.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '1970-01-01';
  }

  _findConnectedCards(startCard, network, visited, minSize) {
    const cluster = [startCard];
    const queue = [startCard];
    visited.add(startCard);

    while (queue.length > 0 && cluster.length < minSize * 2) {
      const current = queue.shift();

      // Find strongly connected cards
      const strongEdges = network.edges.filter(edge =>
        (edge.source === current || edge.target === current) &&
        edge.strength > 0.5
      );

      strongEdges.forEach(edge => {
        const neighbor = edge.source === current ? edge.target : edge.source;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          cluster.push(neighbor);
          queue.push(neighbor);
        }
      });
    }

    return cluster;
  }

  _calculateClusterStrength(cluster, network) {
    let totalStrength = 0;
    let edgeCount = 0;

    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        const edge = network.edges.find(e =>
          (e.source === cluster[i] && e.target === cluster[j]) ||
          (e.source === cluster[j] && e.target === cluster[i])
        );

        if (edge) {
          totalStrength += edge.strength;
          edgeCount++;
        }
      }
    }

    return edgeCount > 0 ? totalStrength / edgeCount : 0;
  }

  _exportToCSV(network) {
    const headers = ['Source,Target,Strength,Confidence,Lift,Cooccurrence,Decks With Both'];
    const rows = network.edges.map(edge =>
      `"${edge.source}","${edge.target}",${edge.strength.toFixed(4)},${edge.confidence.toFixed(4)},${edge.lift.toFixed(4)},${edge.cooccurrence.toFixed(4)},${edge.decksWithBoth}`
    );

    return [headers, ...rows].join('\n');
  }
}

/**
 * Utility functions for synergy analysis
 */
export const SynergyUtils = {
  /**
   * Format synergy strength as percentage
   */
  formatStrength(strength) {
    return `${(strength * 100).toFixed(1)}%`;
  },

  /**
   * Get synergy strength category
   */
  getStrengthCategory(strength) {
    if (strength >= 2.0) {return 'very-strong';}
    if (strength >= 1.0) {return 'strong';}
    if (strength >= 0.5) {return 'moderate';}
    if (strength >= 0.1) {return 'weak';}
    return 'very-weak';
  },

  /**
   * Generate color for synergy strength
   */
  getStrengthColor(strength) {
    const colors = {
      'very-strong': '#d32f2f',
      'strong': '#f57c00',
      'moderate': '#fbc02d',
      'weak': '#689f38',
      'very-weak': '#1976d2'
    };
    return colors[this.getStrengthCategory(strength)] || '#757575';
  }
};
