/**
 * Main application controller for synergy analysis page
 * @module SynergyApp
 */

import { fetchTournamentsList, fetchDecks, fetchReport } from './api.js';
import { SynergyAnalyzer, SynergyUtils } from './synergy.js';
import { SynergyNetworkViz } from './synergyViz.js';
import { logger } from './utils/logger.js';
import { safeAsync } from './utils/errorHandler.js';
import { debounce } from './utils/performance.js';

/**
 * Main synergy application class
 */
class SynergyApp {
  constructor() {
    this.analyzer = new SynergyAnalyzer();
    this.visualization = null;
    this.currentTournament = null;
    this.currentData = null;
    this.networkData = null;
    this.cachedFullNetwork = null;
    this.cacheSettings = null;

    this.initializeApp();
  }

  /**
   * Initialize the application
   */
  async initializeApp() {
    try {
      logger.info('Initializing synergy analysis application');

      // Initialize UI elements
      this.initializeElements();

      // Setup event listeners
      this.setupEventListeners();

      // Load tournament list
      await this.loadTournaments();

      logger.info('Synergy application initialized successfully');

    } catch (error) {
      logger.exception('Failed to initialize synergy application', error);
      this.showError('Failed to initialize application. Please refresh and try again.');
    }
  }

  /**
   * Initialize UI elements
   */
  initializeElements() {
    this.elements = {
      tournamentSelect: document.getElementById('tournament-select'),
      minOccurrence: document.getElementById('min-occurrence'),
      minOccurrenceValue: document.getElementById('min-occurrence-value'),
      minSynergy: document.getElementById('min-synergy'),
      minSynergyValue: document.getElementById('min-synergy-value'),
      cardSearch: document.getElementById('card-search'),
      networkViz: document.getElementById('network-visualization'),
      noSelection: document.getElementById('no-selection'),
      cardDetails: document.getElementById('card-details'),
      selectedCardName: document.getElementById('selected-card-name'),
      cardPopularity: document.getElementById('card-popularity'),
      cardOccurrence: document.getElementById('card-occurrence'),
      cardCategory: document.getElementById('card-category'),
      cardConnections: document.getElementById('card-connections'),
      synergyList: document.getElementById('synergy-list'),
      clustersContainer: document.getElementById('clusters-container'),
      exportCsv: document.getElementById('export-csv'),
      exportJson: document.getElementById('export-json'),
      networkStats: document.getElementById('network-stats')
    };
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Tournament selection
    this.elements.tournamentSelect.addEventListener('change', () => {
      this.loadTournamentData();
    });

    // Control inputs with debouncing
    this.elements.minOccurrence.addEventListener('input', debounce(() => {
      this.elements.minOccurrenceValue.textContent = this.elements.minOccurrence.value;
      this.updateVisualization();
    }, 500));

    this.elements.minSynergy.addEventListener('input', debounce(() => {
      this.elements.minSynergyValue.textContent = parseFloat(this.elements.minSynergy.value).toFixed(3);
      this.updateVisualization();
    }, 500));

    // Search with debounce
    this.elements.cardSearch.addEventListener('input', debounce(() => {
      this.handleCardSearch();
    }, 300));

    // Export buttons
    this.elements.exportCsv.addEventListener('click', () => this.exportData('csv'));
    this.elements.exportJson.addEventListener('click', () => this.exportData('json'));

    // Network visualization events
    this.elements.networkViz.addEventListener('nodeSelected', (event) => {
      this.handleNodeSelection(event.detail);
    });

    this.elements.networkViz.addEventListener('nodeDeselected', () => {
      this.clearNodeSelection();
    });

    // Window resize
    window.addEventListener('resize', debounce(() => {
      if (this.visualization) {
        this.resizeVisualization();
      }
    }, 250));
  }

  /**
   * Load available tournaments
   */
  async loadTournaments() {
    try {
      const tournaments = await safeAsync(
        () => fetchTournamentsList(),
        'fetching tournaments list',
        []
      );

      // Clear existing options
      this.elements.tournamentSelect.innerHTML = '<option value="">Select a tournament...</option>';

      // Add tournament options
      tournaments.forEach(tournament => {
        const option = document.createElement('option');
        option.value = tournament;
        option.textContent = this.formatTournamentName(tournament);
        this.elements.tournamentSelect.appendChild(option);
      });

      // Select most recent tournament by default
      if (tournaments.length > 0) {
        this.elements.tournamentSelect.value = tournaments[0];
        await this.loadTournamentData();
      }

    } catch (error) {
      logger.exception('Failed to load tournaments', error);
      this.showError('Failed to load tournaments list.');
    }
  }

  /**
   * Load tournament data and build synergy network
   */
  async loadTournamentData() {
    const tournament = this.elements.tournamentSelect.value;
    if (!tournament) {
      this.clearVisualization();
      return;
    }

    if (tournament === this.currentTournament) {
      return; // Already loaded
    }

    this.currentTournament = tournament;

    // Clear cache when switching tournaments
    this.cachedFullNetwork = null;
    this.cacheSettings = null;

    this.showLoading();

    try {
      logger.info(`Loading tournament data: ${tournament}`);

      // Try to load deck data first (more detailed)
      let decks = await safeAsync(
        () => fetchDecks(tournament),
        `fetching deck data for ${tournament}`,
        null
      );

      // If deck data not available, create from master.json
      if (!decks) {
        logger.debug('Deck data not available, creating from master data');
        const masterData = await fetchReport(tournament);
        decks = this.createDecksFromMaster(masterData);
      }

      this.currentData = decks;
      logger.info(`Loaded ${decks.length} decks for analysis`);

      // Build initial network
      await this.updateVisualization();

    } catch (error) {
      logger.exception(`Failed to load tournament data: ${tournament}`, error);
      this.showError(`Failed to load data for ${tournament}`);
    }
  }

  /**
   * Update visualization with current settings
   */
  async updateVisualization() {
    if (!this.currentData) {return;}

    const minOccurrence = parseInt(this.elements.minOccurrence.value);
    const minSynergy = parseFloat(this.elements.minSynergy.value);

    // Check if we can use cached network and just filter it
    if (this.cachedFullNetwork && this.canUseCache(minOccurrence, minSynergy)) {
      this.filterExistingNetwork(minOccurrence, minSynergy);
      return;
    }

    this.showLoading();

    try {
      logger.debug(`Building new network: minOccurrence=${minOccurrence}, minSynergy=${minSynergy}`);

      // Build network data with more permissive settings for caching
      const cacheMinOccurrence = Math.min(minOccurrence, 2);
      const cacheMinSynergy = Math.min(minSynergy, 0.01);

      this.cachedFullNetwork = this.analyzer.buildSynergyNetwork(
        this.currentData,
        cacheMinOccurrence,
        cacheMinSynergy
      );

      this.cacheSettings = { minOccurrence: cacheMinOccurrence, minSynergy: cacheMinSynergy };

      // Filter to current settings
      this.filterExistingNetwork(minOccurrence, minSynergy);

      logger.info(`Network built and filtered: ${this.networkData.nodes.length} nodes, ${this.networkData.edges.length} edges`);

    } catch (error) {
      logger.exception('Failed to update visualization', error);
      this.showError('Failed to update visualization');
    }
  }

  /**
   * Check if we can use cached network data
   */
  canUseCache(minOccurrence, minSynergy) {
    return this.cacheSettings &&
           minOccurrence >= this.cacheSettings.minOccurrence &&
           minSynergy >= this.cacheSettings.minSynergy;
  }

  /**
   * Filter existing network without rebuilding
   */
  filterExistingNetwork(minOccurrence, minSynergy) {
    if (!this.cachedFullNetwork) {return;}

    // Filter nodes by occurrence
    const validNodes = this.cachedFullNetwork.nodes.filter(node =>
      node.occurrence >= minOccurrence
    );
    const validNodeIds = new Set(validNodes.map(n => n.id));

    // Filter edges by synergy strength and node validity
    const validEdges = this.cachedFullNetwork.edges.filter(edge =>
      edge.strength >= minSynergy &&
      validNodeIds.has(edge.source) &&
      validNodeIds.has(edge.target)
    );

    this.networkData = {
      nodes: validNodes,
      edges: validEdges,
      metadata: {
        ...this.cachedFullNetwork.metadata,
        filteredMinOccurrence: minOccurrence,
        filteredMinSynergy: minSynergy,
        filteredAt: new Date().toISOString()
      }
    };

    // Initialize or update visualization
    if (!this.visualization) {
      this.initializeVisualization();
    }

    this.visualization.render(this.networkData);

    // Update performance stats
    this.updateNetworkStats();

    // Update clusters
    this.updateClusters();
  }

  /**
   * Initialize network visualization
   */
  initializeVisualization() {
    const container = this.elements.networkViz;
    const rect = container.getBoundingClientRect();

    this.visualization = new SynergyNetworkViz(container, {
      width: rect.width || 800,
      height: 600
    });

    logger.debug('Network visualization initialized');
  }

  /**
   * Handle card search
   */
  handleCardSearch() {
    const query = this.elements.cardSearch.value.trim();

    if (!this.visualization) {return;}

    if (query) {
      this.visualization.searchNodes(query);
    } else {
      this.visualization.reset();
    }
  }

  /**
   * Handle node selection in visualization
   */
  handleNodeSelection(detail) {
    const { node, connectedNodes, connectedLinks } = detail;

    // Show card details
    this.elements.noSelection.style.display = 'none';
    this.elements.cardDetails.classList.add('active');

    // Populate card information
    this.elements.selectedCardName.textContent = node.name;
    this.elements.cardPopularity.textContent = `${(node.popularity * 100).toFixed(1)}%`;
    this.elements.cardOccurrence.textContent = node.occurrence;
    this.elements.cardCategory.textContent = this.formatCategory(node.group);
    this.elements.cardConnections.textContent = connectedNodes.length;

    // Show top synergies
    this.updateSynergyList(node, connectedLinks);

    logger.debug(`Selected card: ${node.name}`);
  }

  /**
   * Clear node selection
   */
  clearNodeSelection() {
    this.elements.cardDetails.classList.remove('active');
    this.elements.noSelection.style.display = 'block';
  }

  /**
   * Update synergy list for selected card
   */
  updateSynergyList(selectedNode, connectedLinks) {
    const synergyList = this.elements.synergyList;
    synergyList.innerHTML = '';

    // Sort connections by strength
    const sortedLinks = connectedLinks
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10); // Show top 10

    sortedLinks.forEach(link => {
      const partnerCard = link.source.id === selectedNode.id ? link.target : link.source;

      const item = document.createElement('div');
      item.className = 'synergy-item';

      const strengthClass = `strength-${SynergyUtils.getStrengthCategory(link.strength)}`;

      item.innerHTML = `
        <span class="synergy-card-name">${partnerCard.name}</span>
        <span class="synergy-strength ${strengthClass}">${SynergyUtils.formatStrength(link.strength)}</span>
      `;

      synergyList.appendChild(item);
    });

    if (sortedLinks.length === 0) {
      synergyList.innerHTML = '<p>No significant synergies found.</p>';
    }
  }

  /**
   * Update network performance statistics
   */
  updateNetworkStats() {
    if (!this.networkData || !this.elements.networkStats) {return;}

    const { nodes, edges } = this.networkData;
    const totalCards = this.cachedFullNetwork ? this.cachedFullNetwork.nodes.length : nodes.length;
    const totalEdges = this.cachedFullNetwork ? this.cachedFullNetwork.edges.length : edges.length;

    let statsText = `Showing ${nodes.length} cards and ${edges.length} relationships`;

    if (nodes.length < totalCards || edges.length < totalEdges) {
      statsText += ` (filtered from ${totalCards} cards and ${totalEdges} relationships)`;
    }

    this.elements.networkStats.textContent = statsText;
  }

  /**
   * Update synergy clusters
   */
  updateClusters() {
    if (!this.networkData) {return;}

    const clusters = this.analyzer.findSynergyClusters(this.networkData, 3);
    const container = this.elements.clustersContainer;

    container.innerHTML = '';

    if (clusters.length === 0) {
      container.innerHTML = '<p>No significant clusters found with current settings.</p>';
      return;
    }

    clusters.slice(0, 6).forEach((cluster, index) => {
      const item = document.createElement('div');
      item.className = 'cluster-item';

      item.innerHTML = `
        <div class="cluster-title">Cluster ${index + 1} (${cluster.size} cards)</div>
        <div class="cluster-cards">${cluster.cards.join(', ')}</div>
        <div class="cluster-strength">Average Strength: ${SynergyUtils.formatStrength(cluster.strength)}</div>
      `;

      container.appendChild(item);
    });

    logger.debug(`Updated clusters: ${clusters.length} found`);
  }

  /**
   * Export synergy data
   */
  exportData(format) {
    if (!this.networkData) {
      this.showError('No data to export. Please select a tournament first.');
      return;
    }

    try {
      const exportData = this.analyzer.exportSynergyData(this.networkData, format);
      const filename = `synergy-${this.currentTournament}-${new Date().toISOString().split('T')[0]}.${format}`;

      this.downloadFile(exportData, filename, format === 'csv' ? 'text/csv' : 'application/json');

      logger.info(`Exported synergy data: ${format.toUpperCase()}`);

    } catch (error) {
      logger.exception(`Failed to export data as ${format}`, error);
      this.showError(`Failed to export data as ${format.toUpperCase()}`);
    }
  }

  /**
   * Resize visualization
   */
  resizeVisualization() {
    const rect = this.elements.networkViz.getBoundingClientRect();
    this.visualization.resize(rect.width, 600);
  }

  /**
   * Create deck data from master.json format
   */
  createDecksFromMaster(masterData) {
    // This is a simplified approach - in practice, you'd need actual deck lists
    // For now, we'll create synthetic deck data based on card co-occurrence probabilities

    logger.warn('Creating synthetic deck data from master.json - synergy analysis may be less accurate');

    const decks = [];
    const cards = masterData.items || [];

    // Create synthetic decks based on card popularity (reduced for performance)
    for (let i = 0; i < 25; i++) {
      const deck = {
        id: `synthetic_${i}`,
        cards: []
      };

      // Add popular cards with probability based on their usage
      cards.forEach(card => {
        const probability = card.pct / 100;
        if (Math.random() < probability) {
          deck.cards.push({
            name: card.name,
            count: card.dist && card.dist.length > 0
              ? card.dist[Math.floor(Math.random() * card.dist.length)].copies
              : 1
          });
        }
      });

      if (deck.cards.length > 0) {
        decks.push(deck);
      }
    }

    return decks;
  }

  /**
   * Show loading state
   */
  showLoading() {
    this.elements.networkViz.innerHTML = '<div class="loading"><p>Analyzing synergies...</p></div>';
  }

  /**
   * Clear visualization
   */
  clearVisualization() {
    this.elements.networkViz.innerHTML = '<div class="loading"><p>Select a tournament to view card synergies...</p></div>';
    this.elements.clustersContainer.innerHTML = '';
    this.clearNodeSelection();
  }

  /**
   * Show error message
   */
  showError(message) {
    this.elements.networkViz.innerHTML = `
      <div class="empty-state">
        <h3>Error</h3>
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * Format tournament name for display
   */
  formatTournamentName(tournament) {
    return tournament.replace(/^\d{4}-\d{2}-\d{2}, /, '');
  }

  /**
   * Format category name for display
   */
  formatCategory(category) {
    const categoryNames = {
      'pokemon-main': 'Main Pokemon',
      'pokemon': 'Pokemon',
      'trainer': 'Trainer',
      'energy': 'Energy'
    };
    return categoryNames[category] || 'Unknown';
  }

  /**
   * Download file helper
   */
  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SynergyApp();
});
