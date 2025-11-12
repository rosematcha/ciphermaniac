import { fetchReportResource, fetchTournamentsList } from './api.js';

class SocialGraphicsGenerator {
  constructor() {
    this.tournaments = [];
    this.currentTournamentData = null;
    this.previousTournamentData = null;
    this.comparisonTournamentData = null;
    this.consistentLeaders = new Set();

    this.init();
  }

  /**
   * Safely read .value from an input/select element by id with JSDoc casting for type checkers
   * @param {string} id
   * @returns {string}
   */
  getFieldValue(id) {
    const el = document.getElementById(id);
    if (!el) {
      return '';
    }
    /** @type {HTMLInputElement|HTMLSelectElement} */
    // @ts-ignore - JSDoc cast for JS file
    const typed = el;
    return typed.value ?? '';
  }

  async init() {
    try {
      await this.loadTournaments();
      await this.loadConsistentLeaders();
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to initialize social graphics generator:', error);
    }
  }

  async loadTournaments() {
    try {
      const tournamentNames = await fetchTournamentsList();
      this.tournaments = tournamentNames
        .map((name, index) => ({
          folder: name,
          name,
          index
        }))
        .sort((first, second) => second.folder.localeCompare(first.folder)); // Sort by date desc
      this.populateTournamentSelect();
    } catch (error) {
      console.error('Failed to load tournaments:', error);
      this.showError('Failed to load tournament list');
    }
  }

  populateTournamentSelect() {
    const select = document.getElementById('tournament-select');
    const comparisonSelect = document.getElementById('comparison-tournament-select');

    select.innerHTML = '<option value="">Select a tournament...</option>';
    comparisonSelect.innerHTML = '<option value="">No comparison...</option>';

    this.tournaments.forEach(tournament => {
      // Extract tournament name without date (remove "YYYY-MM-DD, " prefix)
      const nameWithoutDate = tournament.name.replace(/^\d{4}-\d{2}-\d{2}, /, '');

      // Main tournament select
      const option = document.createElement('option');
      option.value = tournament.folder;
      option.textContent = nameWithoutDate;
      select.appendChild(option);

      // Comparison tournament select
      const comparisonOption = document.createElement('option');
      comparisonOption.value = tournament.folder;
      comparisonOption.textContent = nameWithoutDate;
      comparisonSelect.appendChild(comparisonOption);
    });
  }

  async loadConsistentLeaders() {
    try {
      const suggestions = await fetchReportResource('suggestions.json', 'suggestions', 'object', 'suggestions', {
        cache: true
      });

      // Find the consistent leaders category
      const consistentLeadersCategory = suggestions.categories.find(cat => cat.id === 'consistent-leaders');
      if (consistentLeadersCategory) {
        // Transform card names to match the filtering logic
        consistentLeadersCategory.items.forEach(item => {
          const transformedName = item.name.replace(/[^a-zA-Z0-9]/g, '_');
          this.consistentLeaders.add(transformedName);
        });
      }
    } catch (error) {
      console.error('Failed to load consistent leaders:', error);
      this.showError('Failed to load consistent leaders data');
    }
  }

  showError(message) {
    const output = document.getElementById('graphics-output');
    output.innerHTML = `<div style="color: red; padding: 20px; text-align: center;">${message}</div>`;
  }

  setupEventListeners() {
    document.getElementById('generate-btn').addEventListener('click', () => this.generateGraphics());
    document.getElementById('export-png').addEventListener('click', () => this.exportGraphics('png'));
    document.getElementById('export-jpg').addEventListener('click', () => this.exportGraphics('jpg'));
  }

  async generateGraphics() {
    const tournamentFolder = this.getFieldValue('tournament-select');
    const comparisonTournamentFolder = this.getFieldValue('comparison-tournament-select');

    if (!tournamentFolder) {
      this.showError('Please select a tournament first.');
      return;
    }

    try {
      // Load main tournament data
      this.currentTournamentData = await fetchReportResource(
        `${tournamentFolder}/master.json`,
        'tournament data',
        'object',
        'tournament data'
      );

      // Load comparison tournament data if selected
      if (comparisonTournamentFolder && comparisonTournamentFolder !== tournamentFolder) {
        try {
          this.comparisonTournamentData = await fetchReportResource(
            `${comparisonTournamentFolder}/master.json`,
            'comparison tournament data',
            'object',
            'comparison tournament data'
          );
        } catch (error) {
          console.warn('Failed to load comparison tournament data:', error);
          this.comparisonTournamentData = null;
        }
      } else {
        this.comparisonTournamentData = null;
      }

      // Load previous tournament for rising cards comparison
      const currentIndex = this.tournaments.findIndex(tournament => tournament.folder === tournamentFolder);
      if (currentIndex < this.tournaments.length - 1) {
        const previousFolder = this.tournaments[currentIndex + 1].folder;
        try {
          this.previousTournamentData = await fetchReportResource(
            `${previousFolder}/master.json`,
            'previous tournament data',
            'object',
            'previous tournament data'
          );
        } catch (error) {
          console.warn('Failed to load previous tournament data:', error);
          this.previousTournamentData = null;
        }
      } else {
        this.previousTournamentData = null;
      }

      await this.renderGraphics();
    } catch (error) {
      console.error('Failed to generate graphics:', error);
      this.showError(`Failed to load tournament data: ${error.message}`);
    }
  }

  async renderGraphics() {
    const displayMode = this.getFieldValue('display-mode');
    const layoutValue = this.getFieldValue('graphics-layout');
    const layoutSize = parseInt(layoutValue, 10) || 20;

    let filteredData = this.getFilteredData(displayMode);
    filteredData = filteredData.slice(0, layoutSize);

    const output = document.getElementById('graphics-output');
    output.innerHTML = '';

    if (filteredData.length === 0) {
      return;
    }

    // Create header section
    const headerSection = this.createHeaderSection(displayMode);
    output.appendChild(headerSection);

    // Create tournament layout structure
    const tournamentLayout = document.createElement('div');
    tournamentLayout.className = 'tournament-layout';

    // Main tournament section (featured + bracket-right)
    const tournamentMain = document.createElement('div');
    tournamentMain.className = 'tournament-main';

    // Featured card container (rank #1)
    const featuredContainer = document.createElement('div');
    featuredContainer.className = 'featured-card-container';

    // Bracket right side container
    const bracketRight = document.createElement('div');
    bracketRight.className = 'bracket-right';

    // Create featured card (rank #1)
    if (filteredData.length > 0) {
      const featuredCard = await this.createCardGraphic(filteredData[0], 1, displayMode, 'featured');
      featuredContainer.appendChild(featuredCard);
    }

    // Medium row (ranks 2, 3, 4)
    if (filteredData.length > 1) {
      const mediumRow = document.createElement('div');
      mediumRow.className = 'bracket-row medium-row';

      for (let i = 1; i <= 3 && i < filteredData.length; i++) {
        const mediumCard = await this.createCardGraphic(filteredData[i], i + 1, displayMode, 'medium');
        mediumRow.appendChild(mediumCard);
      }
      bracketRight.appendChild(mediumRow);
    }

    // Small row (ranks 5, 6, 7, 8)
    if (filteredData.length > 4) {
      const smallRow = document.createElement('div');
      smallRow.className = 'bracket-row small-row';

      for (let i = 4; i <= 7 && i < filteredData.length; i++) {
        const smallCard = await this.createCardGraphic(filteredData[i], i + 1, displayMode, 'small');
        smallRow.appendChild(smallCard);
      }
      bracketRight.appendChild(smallRow);
    }

    // Assemble main tournament section
    tournamentMain.appendChild(featuredContainer);
    tournamentMain.appendChild(bracketRight);

    // Bottom row (ranks 9-14)
    const _hasBottomRow = false;
    if (filteredData.length > 8) {
      const bottomRow = document.createElement('div');
      bottomRow.className = 'bottom-row';

      for (let i = 8; i <= 13 && i < filteredData.length; i++) {
        const bottomCard = await this.createCardGraphic(filteredData[i], i + 1, displayMode, 'tiny');
        bottomRow.appendChild(bottomCard);
      }

      tournamentLayout.appendChild(tournamentMain);
      tournamentLayout.appendChild(bottomRow);
      const _hasBottomRow = true;
    } else {
      tournamentLayout.appendChild(tournamentMain);
    }

    // Second bottom row (ranks 15-20)
    if (filteredData.length > 14) {
      const secondBottomRow = document.createElement('div');
      secondBottomRow.className = 'bottom-row';

      for (let i = 14; i <= 19 && i < filteredData.length; i++) {
        const secondBottomCard = await this.createCardGraphic(filteredData[i], i + 1, displayMode, 'tiny');
        secondBottomRow.appendChild(secondBottomCard);
      }

      tournamentLayout.appendChild(secondBottomRow);
    }

    output.appendChild(tournamentLayout);
  }

  createHeaderSection(displayMode) {
    const headerSection = document.createElement('div');
    headerSection.className = 'graphics-header';

    // Get tournament names without dates
    const tournamentFolder = this.getFieldValue('tournament-select');
    const comparisonTournamentFolder = this.getFieldValue('comparison-tournament-select');

    const currentTournament = this.tournaments.find(tournament => tournament.folder === tournamentFolder);
    const comparisonTournament = this.tournaments.find(tournament => tournament.folder === comparisonTournamentFolder);

    const currentName = currentTournament ? currentTournament.name.replace(/^\d{4}-\d{2}-\d{2}, /, '') : '';
    const comparisonName = comparisonTournament ? comparisonTournament.name.replace(/^\d{4}-\d{2}-\d{2}, /, '') : '';

    // Main title based on display mode
    const title = document.createElement('h2');
    title.className = 'graphics-title';

    let titleText = '';
    switch (displayMode) {
      case 'standard':
        titleText = 'Most Used Cards';
        break;
      case 'no-leaders':
        titleText = 'Most Used Cards (Excluding Consistent Leaders)';
        break;
      case 'rising':
        titleText = 'Most On-the-Rise Cards';
        break;
      default:
        titleText = 'Tournament Usage';
    }
    title.textContent = titleText;

    // Subtitle with tournament info
    const subtitle = document.createElement('p');
    subtitle.className = 'graphics-subtitle';

    let subtitleText = `at ${currentName}`;
    // Only show comparison in subtitle for rising mode when comparison tournament is selected
    if (displayMode === 'rising' && comparisonName && comparisonName !== currentName) {
      subtitleText += ` vs. ${comparisonName}`;
    }
    subtitle.textContent = subtitleText;

    headerSection.appendChild(title);
    headerSection.appendChild(subtitle);

    return headerSection;
  }

  getFilteredData(displayMode) {
    const data = this.currentTournamentData.items.filter(card => card.set !== 'SVE');

    switch (displayMode) {
      case 'standard':
        return data;

      case 'no-leaders':
        return data.filter(card => !this.isConsistentLeader(card));

      case 'rising':
        return this.getRisingCards(data);

      default:
        return data;
    }
  }

  getRisingCards(currentData) {
    // Use comparison tournament if available, otherwise fall back to previous tournament
    const comparisonData = this.comparisonTournamentData || this.previousTournamentData;

    if (!comparisonData) {
      // If no comparison data, show message and return empty
      const message = this.comparisonTournamentData
        ? 'No comparison tournament data available.'
        : 'No previous tournament data available for comparison. Rising cards mode requires historical data.';
      this.showError(message);
      return [];
    }

    // Create lookup map for comparison tournament data
    const comparisonLookup = new Map();
    comparisonData.items.forEach(card => {
      comparisonLookup.set(card.uid, card.pct);
    });

    // Calculate increases and filter out new cards (0% to something)
    const risingCards = [];
    currentData.forEach(card => {
      const comparisonPct = comparisonLookup.get(card.uid);

      if (comparisonPct !== undefined && comparisonPct > 0) {
        const increase = card.pct - comparisonPct;
        if (increase > 0) {
          risingCards.push({
            ...card,
            increase,
            previousPct: comparisonPct
          });
        }
      }
    });

    // Sort by increase amount (descending)
    return risingCards.sort((first, second) => second.increase - first.increase);
  }

  isConsistentLeader(card) {
    const cardKey = card.name.replace(/[^a-zA-Z0-9]/g, '_');
    return this.consistentLeaders.has(cardKey);
  }

  async createCardGraphic(card, displayRank, displayMode = 'standard', cardSize = 'normal') {
    const cardDiv = document.createElement('div');
    cardDiv.className =
      cardSize === 'featured'
        ? 'card-graphic featured'
        : cardSize === 'medium'
          ? 'card-graphic medium'
          : cardSize === 'small'
            ? 'card-graphic small'
            : cardSize === 'tiny'
              ? 'card-graphic tiny'
              : 'card-graphic';

    // Add rank badge
    const rankBadge = document.createElement('div');
    rankBadge.className = 'card-rank-badge';
    rankBadge.textContent = displayRank;
    cardDiv.appendChild(rankBadge);

    const imageContainer = document.createElement('div');
    imageContainer.className = 'card-image-container';

    const img = document.createElement('img');
    img.className = 'card-image';
    // Enable CORS for external images (Limitless CDN)
    img.crossOrigin = 'anonymous';

    const imagePath = await this.loadImageWithFallback(card, cardSize);
    if (imagePath) {
      img.src = imagePath;
      img.alt = card.name;
      await this.applyCropping(img, card, cardSize);
    } else {
      img.style.backgroundColor = '#ddd';
      img.style.display = 'flex';
      img.style.alignItems = 'center';
      img.style.justifyContent = 'center';
      img.style.color = '#666';
      img.innerHTML = 'No Image';
      console.warn(`No image found for ${card.name} (${card.set} ${card.number})`);
    }

    imageContainer.appendChild(img);

    // Create chin section like home grid
    const cardChin = document.createElement('div');
    cardChin.className = 'card-chin';

    const chinLeft = document.createElement('div');
    chinLeft.className = 'card-chin-left';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'card-name';
    nameDiv.textContent = card.name;

    const usageInfo = document.createElement('div');
    usageInfo.className = 'card-usage';

    if (displayMode === 'rising' && card.increase !== undefined) {
      usageInfo.textContent = `+${card.increase.toFixed(1)}% increase`;
    } else {
      usageInfo.textContent = `${card.found}/${card.total} decks`;
    }

    const chinRight = document.createElement('div');
    chinRight.className = 'card-chin-right';
    chinRight.textContent = `${card.pct}%`;

    chinLeft.appendChild(nameDiv);
    chinLeft.appendChild(usageInfo);

    cardChin.appendChild(chinLeft);
    cardChin.appendChild(chinRight);

    cardDiv.appendChild(imageContainer);
    cardDiv.appendChild(cardChin);

    return cardDiv;
  }

  getCardImagePath(card) {
    const imageName = `${card.name.replace(/[^a-zA-Z0-9]/g, '_')}_${card.set}_${card.number}.png`;
    return `thumbnails/sm/${imageName}`;
  }

  async loadImageWithFallback(card, _cardSize = 'normal') {
    const baseName = card.name.replace(/[^a-zA-Z0-9]/g, '_');

    // Special case transformations for known patterns
    let specialName = card.name;

    // Handle "Buddy-Buddy" pattern (preserve hyphen in Buddy-Buddy, convert space to underscore)
    if (card.name.includes('Buddy-Buddy')) {
      specialName = card.name.replace(/\s+/g, '_'); // Convert spaces to underscores first
      specialName = specialName.replace(/[^a-zA-Z0-9\-_]/g, '_'); // Keep hyphens and underscores
    }
    // Handle "Technical Machine: X" pattern (colon becomes single underscore)
    else if (card.name.startsWith('Technical Machine:')) {
      specialName = card.name.replace('Technical Machine:', 'Technical_Machine');
      specialName = specialName.replace(/[^a-zA-Z0-9]/g, '_');
    }
    // Handle cards with special characters that should be preserved (periods, accents, decimals)
    else if (
      card.name.includes('Pokégear 3.0') ||
      card.name.includes('Exp. Share') ||
      card.name.match(/\d+\.\d+/) || // Decimal numbers like 3.0
      card.name.match(/\w+\.\s+\w+/)
    ) {
      // Abbreviations like "Exp. Share"
      specialName = card.name.replace(/\s+/g, '_'); // Only convert spaces to underscores
    }

    // Build Limitless CDN URL
    const limitlessUrl = this.buildLimitlessUrl(card.set, card.number);

    const possiblePaths = [
      `/thumbnails/sm/${baseName}_${card.set}_${card.number}.png`,
      `/thumbnails/sm/${card.name.replace(/[^a-zA-Z0-9']/g, '_')}_${card.set}_${card.number}.png`,
      `/thumbnails/sm/${card.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')}_${card.set}_${card.number}.png`,
      `/thumbnails/sm/${specialName.replace(/[^a-zA-Z0-9-]/g, '_')}_${card.set}_${card.number}.png`,
      limitlessUrl // Add Limitless CDN as fallback
    ].filter(Boolean); // Remove null values

    for (const path of possiblePaths) {
      try {
        const img = new Image();
        // Enable CORS for external images
        img.crossOrigin = 'anonymous';
        const loadPromise = new Promise((resolve, reject) => {
          img.onload = () => resolve(path);
          img.onerror = reject;
          img.src = path;
        });

        const result = await Promise.race([
          loadPromise,
          new Promise((_resolve, reject) => {
            // eslint-disable-next-line no-promise-executor-return, prefer-promise-reject-errors
            return setTimeout(() => reject(new Error('timeout')), 1000);
          })
        ]);

        return result;
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  buildLimitlessUrl(setCode, number) {
    if (!setCode || !number) {
      return null;
    }

    const normalizedSet = String(setCode).toUpperCase().trim();
    const normalizedNumber = String(number).trim();

    if (!normalizedSet || !normalizedNumber) {
      return null;
    }

    // Pad number with leading zeroes to at least 3 digits
    const paddedNumber = normalizedNumber.padStart(3, '0');

    // Use SM size for social graphics (small thumbnails)
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${normalizedSet}/${normalizedSet}_${paddedNumber}_R_EN_SM.png`;
  }

  applyCropping(img, card, _cardSize = 'normal') {
    return new Promise(resolve => {
      // Prevent recursive cropping by checking if already processed
      if (img.dataset.cropped === 'true') {
        resolve();
        return;
      }

      const originalOnload = () => {
        try {
          // Mark as processed to prevent recursion
          // eslint-disable-next-line no-param-reassign
          img.dataset.cropped = 'true';

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // Use proper aspect ratios for card display
          const canvasWidth =
            _cardSize === 'featured'
              ? 400
              : _cardSize === 'medium'
                ? 300
                : _cardSize === 'small'
                  ? 240
                  : _cardSize === 'tiny'
                    ? 200
                    : 300;
          const canvasHeight =
            _cardSize === 'featured'
              ? 353
              : _cardSize === 'medium'
                ? 160
                : _cardSize === 'small'
                  ? 150
                  : _cardSize === 'tiny'
                    ? 125
                    : 200;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;

          const cropParams = this.getCropParameters(card);

          const sourceWidth = Math.max(1, img.naturalWidth - cropParams.left - cropParams.right);
          const sourceHeight = Math.max(1, img.naturalHeight - cropParams.top - cropParams.bottom);

          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            // Remove the onload handler before changing src to prevent recursion
            // eslint-disable-next-line no-param-reassign
            img.onload = null;
            // eslint-disable-next-line no-param-reassign
            img.onerror = null;

            // Calculate aspect ratios
            const sourceAspect = sourceWidth / sourceHeight;
            const targetAspect = canvasWidth / canvasHeight;

            let drawWidth;
            let drawHeight;
            let drawX;
            let drawY;

            if (sourceAspect > targetAspect) {
              // Source is wider, fit to height and crop sides
              drawHeight = canvasHeight;
              drawWidth = drawHeight * sourceAspect;
              drawX = (canvasWidth - drawWidth) / 2;
              drawY = 0;
            } else {
              // Source is taller, fit to width and crop top/bottom
              drawWidth = canvasWidth;
              drawHeight = drawWidth / sourceAspect;
              drawX = 0;
              drawY = (canvasHeight - drawHeight) / 2;
            }

            ctx.drawImage(
              img,
              cropParams.left,
              cropParams.top,
              sourceWidth,
              sourceHeight,
              drawX,
              drawY,
              drawWidth,
              drawHeight
            );

            // eslint-disable-next-line no-param-reassign
            img.src = canvas.toDataURL();
          }
        } catch (error) {
          console.warn(`Failed to crop image for ${card.name}:`, error);
        }
        resolve();
      };

      // eslint-disable-next-line no-param-reassign
      img.onload = originalOnload;

      // eslint-disable-next-line no-param-reassign
      img.onerror = () => {
        console.warn(`Failed to load image for ${card.name}`);
        resolve();
      };

      if (img.complete && img.naturalWidth > 0) {
        originalOnload();
      }
    });
  }

  getCropParameters(card) {
    const cardType = this.determineCardType(card);

    const sidesCrop = parseInt(this.getFieldValue('crop-sides'), 10) || 22;

    // Use card-type-specific top crop, calculate bottom to maintain consistent final height
    if (cardType === 'pokemon') {
      const topCrop = parseInt(this.getFieldValue('pokemon-crop-top'), 10) || 13;
      const targetHeight = 144;
      const availableHeight = 381 - topCrop; // 274x381 thumbnails
      const bottomCrop = Math.max(0, availableHeight - targetHeight - 100); // Leave some buffer

      return {
        left: sidesCrop,
        right: sidesCrop,
        top: topCrop,
        bottom: bottomCrop
      };
    }
    // Trainers, special-energy, etc.
    const topCrop = parseInt(this.getFieldValue('trainer-crop-top'), 10) || 23;
    const targetHeight = 144;
    const availableHeight = 381 - topCrop;
    const bottomCrop = Math.max(0, availableHeight - targetHeight - 100);

    return {
      left: sidesCrop,
      right: sidesCrop,
      top: topCrop,
      bottom: bottomCrop
    };
  }

  determineCardType(card) {
    const { name } = card;

    // Basic Energy cards (SVE set)
    if (card.set === 'SVE') {
      return 'basic-energy';
    }

    // Special Energy cards - "Energy" is always the last word
    if (name.endsWith(' Energy') && card.set !== 'SVE') {
      return 'special-energy';
    }

    // Pokemon cards - have "ex", "V", "VMAX", "VSTAR"
    if (name.includes(' ex') || name.includes(' V') || name.includes(' VMAX') || name.includes(' VSTAR')) {
      return 'pokemon';
    }

    // Trainer keywords in the name (check these first before explicit names)
    if (
      name.includes('Ball') ||
      name.includes('Rod') ||
      name.includes('Catcher') ||
      name.includes('Switch') ||
      name.includes('Belt') ||
      name.includes('Helmet') ||
      name.includes('Orders') ||
      name.includes('Research') ||
      name.includes('Scenario') ||
      name.includes('Vitality') ||
      name.includes('Tower') ||
      name.includes('Stadium') ||
      name.includes('Training') ||
      name.includes('Guidance') ||
      name.includes('Aid') ||
      name.includes('Machine') ||
      name.includes('Basket') ||
      name.includes('Retrieval') ||
      name.includes('Hammer') ||
      name.includes('Potion') ||
      name.includes('Stretcher') ||
      name.includes('Vessel') ||
      name.includes('Candy') ||
      name.includes('Poffin')
    ) {
      return 'trainer';
    }

    // Explicit trainer cards (supporters, items, stadiums)
    const trainerNames = [
      'Arven',
      'Iono',
      'Artazon',
      'Energy Search Pro',
      'Levincia',
      'Hilda',
      'Crispin',
      'Energy Switch',
      'Briar',
      'Judge',
      'Cyrano',
      'Jacq',
      'Energy Search',
      'Powerglass',
      'Penny',
      'Mesagoza',
      'Carmine',
      'Night Stretcher',
      'Buddy-Buddy Poffin',
      'Rare Candy',
      'Rescue Board',
      "Professor Turo's Scenario",
      'Air Balloon',
      "Professor Sada's Vitality"
    ];

    if (trainerNames.some(trainerName => name.includes(trainerName))) {
      return 'trainer';
    }

    // Everything else is Pokemon (including Fan Rotom, Raging Bolt, Iron Bundle, etc.)
    return 'pokemon';
  }

  createHistogram(distribution) {
    const histogram = document.createElement('div');
    histogram.className = 'histogram';

    // Filter to only show 1-4 copies (Pokemon cards max 4)
    const validDist = distribution.filter(dist => dist.copies <= 4);
    const maxPlayers = Math.max(...validDist.map(dist => dist.players));

    validDist.forEach(dist => {
      const bar = document.createElement('div');
      bar.className = 'histogram-bar';
      bar.style.height = `${(dist.players / maxPlayers) * 15}px`;
      bar.textContent = dist.copies;
      bar.title = `${dist.copies} copies: ${dist.players} players (${dist.percent}%)`;
      histogram.appendChild(bar);
    });

    return histogram;
  }

  async exportGraphics(format) {
    if (!this.currentTournamentData) {
      this.showError('Please generate graphics first.');
      return;
    }

    const output = document.getElementById('graphics-output');

    try {
      const canvas = await html2canvas(output, {
        backgroundColor: '#ffffff',
        scale: 1,
        useCORS: true,
        allowTaint: true,
        imageTimeout: 3000,
        logging: false
      });

      const link = document.createElement('a');
      link.download = `tournament-usage-graphics.${format}`;

      if (format === 'png') {
        link.href = canvas.toDataURL('image/png');
      } else {
        link.href = canvas.toDataURL('image/jpeg', 0.9);
      }

      link.click();
    } catch (error) {
      console.error('Export failed:', error);
      this.showError('Export failed. Please try again.');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // eslint-disable-next-line no-new
  new SocialGraphicsGenerator();
});

const html2canvas = (() => {
  return function (element, options) {
    return new Promise((resolve, reject) => {
      /** @type {any} */
      // @ts-ignore - accessing global from CDN
      const globalWindow = window;
      if (typeof globalWindow.html2canvas !== 'undefined') {
        globalWindow.html2canvas(element, options).then(resolve).catch(reject);
      } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => {
          // @ts-ignore
          globalWindow.html2canvas(element, options).then(resolve).catch(reject);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      }
    });
  };
})();
