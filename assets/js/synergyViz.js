/**
 * Interactive network visualization for card synergies
 * @module SynergyViz
 */

/* global d3 */

import { logger } from './utils/logger.js';
import { SynergyUtils } from './synergy.js';

/**
 * D3.js-based network visualization for synergy data
 */
export class SynergyNetworkViz {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      width: 800,
      height: 600,
      nodeRadius: 8,
      linkOpacity: 0.6,
      nodeOpacity: 0.8,
      chargeStrength: -300,
      linkDistance: 50,
      collideRadius: 20,
      ...options
    };

    this.svg = null;
    this.simulation = null;
    this.zoom = null;
    this.selectedNode = null;
    this.highlightedNodes = new Set();

    this.initializeVisualization();
  }

  /**
   * Initialize the SVG and D3 components
   */
  initializeVisualization() {
    // Clear existing content
    this.container.innerHTML = '';

    // Create SVG
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.options.width)
      .attr('height', this.options.height)
      .style('border', '1px solid #ddd')
      .style('border-radius', '4px');

    // Create zoom behavior
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 3])
      .on('zoom', (event) => {
        this.svg.select('.visualization-group')
          .attr('transform', event.transform);
      });

    this.svg.call(this.zoom);

    // Create main group for all visualization elements
    this.mainGroup = this.svg.append('g')
      .attr('class', 'visualization-group');

    // Create groups for links and nodes (order matters for layering)
    this.linksGroup = this.mainGroup.append('g').attr('class', 'links');
    this.nodesGroup = this.mainGroup.append('g').attr('class', 'nodes');
    this.labelsGroup = this.mainGroup.append('g').attr('class', 'labels');

    // Add legend
    this.createLegend();

    logger.debug('Synergy network visualization initialized');
  }

  /**
   * Render network data
   * @param {Object} networkData - Network data with nodes and edges
   */
  render(networkData) {
    if (!networkData || !networkData.nodes || !networkData.edges) {
      logger.warn('Invalid network data provided to visualization');
      return;
    }

    logger.debug(`Rendering network: ${networkData.nodes.length} nodes, ${networkData.edges.length} edges`);

    // Store original edges for connectivity checking
    this.originalEdges = networkData.edges;

    // Sort nodes by popularity to get the most interesting ones first
    const sortedNodes = [...networkData.nodes].sort((a, b) => b.popularity - a.popularity);
    const sortedEdges = [...networkData.edges].sort((a, b) => b.strength - a.strength);

    // Limit data size for performance but keep it interesting
    const maxNodes = 150;
    const maxEdges = 300;

    const nodes = sortedNodes.slice(0, maxNodes).map(d => ({ ...d }));

    // Filter edges to only include valid nodes and keep strongest connections
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = sortedEdges
      .filter(link => nodeIds.has(link.source) && nodeIds.has(link.target))
      .slice(0, maxEdges)
      .map(d => ({ ...d }));

    // Ensure we have a connected network by including bridging edges
    this.ensureConnectivity(nodes, links, nodeIds);

    logger.debug(`Rendering limited network: ${nodes.length} nodes, ${links.length} edges`);

    // Create force simulation
    this.simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id(d => d.id)
        .distance(d => this.options.linkDistance * (1 / Math.max(d.strength, 0.1)))
        .strength(d => Math.min(d.strength * 0.5, 1))
      )
      .force('charge', d3.forceManyBody().strength(this.options.chargeStrength))
      .force('center', d3.forceCenter(this.options.width / 2, this.options.height / 2))
      .force('collision', d3.forceCollide().radius(this.options.collideRadius));

    // Create links
    const linkElements = this.linksGroup.selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('class', 'synergy-link')
      .attr('stroke', d => SynergyUtils.getStrengthColor(d.strength))
      .attr('stroke-width', d => Math.max(1, d.strength * 3))
      .attr('stroke-opacity', this.options.linkOpacity)
      .style('cursor', 'pointer')
      .on('mouseover', (event, d) => this.onLinkHover(event, d))
      .on('mouseout', () => this.onLinkLeave());

    // Create nodes
    const nodeElements = this.nodesGroup.selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('class', 'synergy-node')
      .attr('r', d => this.options.nodeRadius + (d.popularity * 10))
      .attr('fill', d => this.getNodeColor(d.group))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', this.options.nodeOpacity)
      .style('cursor', 'pointer')
      .on('click', (event, d) => this.onNodeClick(event, d))
      .on('mouseover', (event, d) => this.onNodeHover(event, d))
      .on('mouseout', () => this.onNodeLeave())
      .call(this.createDragBehavior());

    // Create labels (only for highly popular cards initially)
    const labelElements = this.labelsGroup.selectAll('text')
      .data(nodes.filter(d => d.popularity > 0.5))
      .enter()
      .append('text')
      .attr('class', 'synergy-label')
      .attr('dy', -15)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .style('fill', '#333')
      .style('pointer-events', 'none')
      .text(d => this.truncateLabel(d.name, 15));

    // Throttled tick handler for better performance
    let tickCount = 0;
    this.simulation.on('tick', () => {
      tickCount++;
      // Update positions every other tick to reduce rendering load
      if (tickCount % 2 === 0) {
        linkElements
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        nodeElements
          .attr('cx', d => d.x)
          .attr('cy', d => d.y);

        labelElements
          .attr('x', d => d.x)
          .attr('y', d => d.y);
      }
    });

    // Store references for interaction
    this.nodes = nodes;
    this.links = links;
    this.nodeElements = nodeElements;
    this.linkElements = linkElements;
    this.labelElements = labelElements;
  }

  /**
   * Create drag behavior for nodes
   */
  createDragBehavior() {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) {
          this.simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) {
          this.simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      });
  }

  /**
   * Handle node click events
   */
  onNodeClick(event, d) {
    if (this.selectedNode === d) {
      // Deselect if clicking the same node
      this.clearSelection();
    } else {
      // Select new node and highlight connections
      this.selectNode(d);
    }
  }

  /**
   * Select a node and highlight its connections
   */
  selectNode(node) {
    this.selectedNode = node;
    this.highlightedNodes.clear();
    this.highlightedNodes.add(node.id);

    // Find connected nodes
    const connectedNodes = new Set();
    const connectedLinks = [];

    this.links.forEach(link => {
      if (link.source.id === node.id) {
        connectedNodes.add(link.target.id);
        this.highlightedNodes.add(link.target.id);
        connectedLinks.push(link);
      } else if (link.target.id === node.id) {
        connectedNodes.add(link.source.id);
        this.highlightedNodes.add(link.source.id);
        connectedLinks.push(link);
      }
    });

    // Update visual styling
    this.nodeElements
      .attr('opacity', d => this.highlightedNodes.has(d.id) ? 1 : 0.2)
      .attr('stroke-width', d => d.id === node.id ? 4 : 2);

    this.linkElements
      .attr('stroke-opacity', d => connectedLinks.includes(d) ? 0.8 : 0.1);

    // Show labels for connected nodes
    this.updateLabels();

    // Dispatch custom event with selection details
    this.container.dispatchEvent(new CustomEvent('nodeSelected', {
      detail: {
        node: node,
        connectedNodes: Array.from(connectedNodes),
        connectedLinks: connectedLinks
      }
    }));

    logger.debug(`Selected node: ${node.name} with ${connectedNodes.size} connections`);
  }

  /**
   * Clear node selection
   */
  clearSelection() {
    this.selectedNode = null;
    this.highlightedNodes.clear();

    // Reset visual styling
    this.nodeElements
      .attr('opacity', this.options.nodeOpacity)
      .attr('stroke-width', 2);

    this.linkElements
      .attr('stroke-opacity', this.options.linkOpacity);

    this.updateLabels();

    // Dispatch deselection event
    this.container.dispatchEvent(new CustomEvent('nodeDeselected'));
  }

  /**
   * Handle node hover
   */
  onNodeHover(event, d) {
    // Create tooltip
    this.showTooltip(event, {
      title: d.name,
      content: [
        `Popularity: ${(d.popularity * 100).toFixed(1)}%`,
        `Appears in: ${d.occurrence} decks`,
        `Category: ${d.group}`
      ]
    });
  }

  /**
   * Handle node hover end
   */
  onNodeLeave() {
    this.hideTooltip();
  }

  /**
   * Handle link hover
   */
  onLinkHover(event, d) {
    this.showTooltip(event, {
      title: `${d.source.name} ↔ ${d.target.name}`,
      content: [
        `Synergy: ${SynergyUtils.formatStrength(d.strength)}`,
        `Confidence: ${(d.confidence * 100).toFixed(1)}%`,
        `Co-occurrence: ${(d.cooccurrence * 100).toFixed(1)}%`,
        `Decks with both: ${d.decksWithBoth}`
      ]
    });
  }

  /**
   * Handle link hover end
   */
  onLinkLeave() {
    this.hideTooltip();
  }

  /**
   * Update label visibility based on current state
   */
  updateLabels() {
    this.labelsGroup.selectAll('text').remove();

    const nodesToLabel = this.highlightedNodes.size > 0
      ? this.nodes.filter(d => this.highlightedNodes.has(d.id))
      : this.nodes.filter(d => d.popularity > 0.5);

    this.labelElements = this.labelsGroup.selectAll('text')
      .data(nodesToLabel)
      .enter()
      .append('text')
      .attr('class', 'synergy-label')
      .attr('dy', -15)
      .attr('text-anchor', 'middle')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .style('fill', '#333')
      .style('pointer-events', 'none')
      .text(d => this.truncateLabel(d.name, 15));
  }

  /**
   * Show tooltip
   */
  showTooltip(event, data) {
    let tooltip = this.container.querySelector('.synergy-tooltip');

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'synergy-tooltip';
      tooltip.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        pointer-events: none;
        z-index: 1000;
        max-width: 200px;
      `;
      this.container.appendChild(tooltip);
    }

    const content = `
      <strong>${data.title}</strong><br>
      ${data.content.join('<br>')}
    `;

    tooltip.innerHTML = content;
    tooltip.style.left = event.offsetX + 10 + 'px';
    tooltip.style.top = event.offsetY - 10 + 'px';
    tooltip.style.display = 'block';
  }

  /**
   * Hide tooltip
   */
  hideTooltip() {
    const tooltip = this.container.querySelector('.synergy-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  /**
   * Create legend for the visualization
   */
  createLegend() {
    const legend = this.svg.append('g')
      .attr('class', 'legend')
      .attr('transform', 'translate(20, 20)');

    const legendData = [
      { label: 'Very Strong (>200%)', color: SynergyUtils.getStrengthColor(2.5) },
      { label: 'Strong (100-200%)', color: SynergyUtils.getStrengthColor(1.5) },
      { label: 'Moderate (50-100%)', color: SynergyUtils.getStrengthColor(0.75) },
      { label: 'Weak (10-50%)', color: SynergyUtils.getStrengthColor(0.3) },
      { label: 'Very Weak (<10%)', color: SynergyUtils.getStrengthColor(0.05) }
    ];

    const legendItems = legend.selectAll('.legend-item')
      .data(legendData)
      .enter()
      .append('g')
      .attr('class', 'legend-item')
      .attr('transform', (d, i) => `translate(0, ${i * 20})`);

    legendItems.append('rect')
      .attr('width', 15)
      .attr('height', 15)
      .attr('fill', d => d.color);

    legendItems.append('text')
      .attr('x', 20)
      .attr('y', 12)
      .style('font-size', '12px')
      .style('fill', '#333')
      .text(d => d.label);
  }

  /**
   * Ensure network connectivity by adding bridging edges
   */
  ensureConnectivity(nodes, links, nodeIds) {
    // Find isolated nodes (nodes with no connections)
    const connectedNodes = new Set();
    links.forEach(link => {
      connectedNodes.add(link.source);
      connectedNodes.add(link.target);
    });

    const isolatedNodes = nodes.filter(node => !connectedNodes.has(node.id));

    // For each isolated node, try to find a connection in the original data
    isolatedNodes.forEach(isolatedNode => {
      // Find the best edge involving this node from the original data
      const allEdges = this.originalEdges || [];
      const possibleEdges = allEdges
        .filter(edge =>
          (edge.source === isolatedNode.id || edge.target === isolatedNode.id) &&
          nodeIds.has(edge.source) && nodeIds.has(edge.target)
        )
        .sort((a, b) => b.strength - a.strength);

      if (possibleEdges.length > 0 && links.length < 300) {
        links.push({ ...possibleEdges[0] });
      }
    });
  }

  /**
   * Get color for node based on category
   */
  getNodeColor(group) {
    const colors = {
      'pokemon-main': '#ff6b6b',
      'pokemon': '#4ecdc4',
      'trainer': '#45b7d1',
      'energy': '#f9ca24'
    };
    return colors[group] || '#95afc0';
  }

  /**
   * Truncate label text
   */
  truncateLabel(text, maxLength) {
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  /**
   * Update visualization size
   */
  resize(width, height) {
    this.options.width = width;
    this.options.height = height;

    this.svg
      .attr('width', width)
      .attr('height', height);

    if (this.simulation) {
      this.simulation
        .force('center', d3.forceCenter(width / 2, height / 2))
        .alpha(0.3)
        .restart();
    }
  }

  /**
   * Filter network by minimum synergy strength
   */
  filterByStrength(minStrength) {
    if (!this.linkElements) {
      return;
    }

    this.linkElements
      .style('display', d => d.strength >= minStrength ? 'block' : 'none');
  }

  /**
   * Search and highlight nodes by name
   */
  searchNodes(query) {
    if (!this.nodeElements) {
      return;
    }

    const searchTerm = query.toLowerCase();
    const matchingNodes = this.nodes.filter(d =>
      d.name.toLowerCase().includes(searchTerm)
    );

    if (matchingNodes.length === 0) {
      this.clearSelection();
      return;
    }

    // Highlight matching nodes
    this.highlightedNodes.clear();
    matchingNodes.forEach(node => this.highlightedNodes.add(node.id));

    this.nodeElements
      .attr('opacity', d => this.highlightedNodes.has(d.id) ? 1 : 0.2);

    this.updateLabels();
  }

  /**
   * Reset all filters and selections
   */
  reset() {
    this.clearSelection();

    if (this.linkElements) {
      this.linkElements.style('display', 'block');
    }

    if (this.nodeElements) {
      this.nodeElements.attr('opacity', this.options.nodeOpacity);
    }
  }

  /**
   * Destroy the visualization and clean up
   */
  destroy() {
    if (this.simulation) {
      this.simulation.stop();
    }

    this.container.innerHTML = '';
    logger.debug('Synergy network visualization destroyed');
  }
}

// Make D3 available globally if not already loaded
if (typeof window !== 'undefined' && !window.d3) {
  logger.warn('D3.js not found. Please include D3.js library for network visualization.');
}
