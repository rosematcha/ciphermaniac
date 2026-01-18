/* eslint-disable no-new */
import { fetchReportResource, fetchTournamentsList } from './api.js';
import { buildThumbCandidates } from './thumbs.js';
import { AppError, ErrorTypes } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';
import { escapeHtml } from './utils/html.js';
import type { CardDistributionEntry, CardItem, TournamentReport } from './types/index.js';

type DisplayMode = 'standard' | 'no-leaders' | 'rising';
type CardSize = 'normal' | 'featured' | 'medium' | 'small' | 'tiny';
type CardType = 'pokemon' | 'trainer' | 'basic-energy' | 'special-energy';

interface TournamentListEntry {
  folder: string;
  name: string;
  index: number;
}

interface SuggestionsPayload {
  categories: Array<{
    id: string;
    items: Array<{
      name: string;
    }>;
  }>;
}

type ReportCard = CardItem & {
  uid?: string;
  increase?: number;
  previousPct?: number;
};

type TournamentReportData = Omit<TournamentReport, 'items'> & {
  items: ReportCard[];
};

interface Html2CanvasOptions {
  backgroundColor?: string;
  scale?: number;
  useCORS?: boolean;
  allowTaint?: boolean;
  imageTimeout?: number;
  logging?: boolean;
}

class SocialGraphicsGenerator {
  tournaments: TournamentListEntry[];
  currentTournamentData: TournamentReportData | null;
  previousTournamentData: TournamentReportData | null;
  comparisonTournamentData: TournamentReportData | null;
  consistentLeaders: Set<string>;
  imageBlobCache: Map<string, string>;

  constructor() {
    this.tournaments = [];
    this.currentTournamentData = null;
    this.previousTournamentData = null;
    this.comparisonTournamentData = null;
    this.consistentLeaders = new Set();
    this.imageBlobCache = new Map();

    this.init();
  }

  /**
   * Safely read .value from an input/select element by id with JSDoc casting for type checkers
   * @param {string} id
   * @returns {string}
   */
  getFieldValue(id: string): string {
    const el = document.getElementById(id);
    if (!el) {
      return '';
    }
    /** @type {HTMLInputElement|HTMLSelectElement} */
    const typed = el as HTMLInputElement | HTMLSelectElement;
    return typed.value ?? '';
  }

  async init(): Promise<void> {
    try {
      await this.loadTournaments();
      await this.loadConsistentLeaders();
      this.setupEventListeners();
    } catch (error) {
      logger.error('Failed to initialize social graphics generator:', error);
    }
  }

  async loadTournaments(): Promise<void> {
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
      logger.error('Failed to load tournaments:', error);
      this.showError('Failed to load tournament list');
    }
  }

  populateTournamentSelect(): void {
    const select = document.getElementById('tournament-select') as HTMLSelectElement | null;
    const comparisonSelect = document.getElementById('comparison-tournament-select') as HTMLSelectElement | null;
    if (!select || !comparisonSelect) {
      return;
    }

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

  async loadConsistentLeaders(): Promise<void> {
    try {
      const suggestions = await fetchReportResource<SuggestionsPayload>(
        'suggestions.json',
        'suggestions',
        'object',
        'suggestions',
        {
          cache: true
        }
      );

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
      logger.error('Failed to load consistent leaders:', error);
      this.showError('Failed to load consistent leaders data');
    }
  }

  showError(message: string): void {
    const output = document.getElementById('graphics-output');
    if (!output) {
      return;
    }
    output.innerHTML = `<div style="color: red; padding: 20px; text-align: center;">${escapeHtml(message)}</div>`;
  }

  setupEventListeners(): void {
    document.getElementById('generate-btn')?.addEventListener('click', () => this.generateGraphics());
    document.getElementById('export-png')?.addEventListener('click', () => this.exportGraphics('png'));
    document.getElementById('export-jpg')?.addEventListener('click', () => this.exportGraphics('jpg'));
  }

  async generateGraphics(): Promise<void> {
    const tournamentFolder = this.getFieldValue('tournament-select');
    const comparisonTournamentFolder = this.getFieldValue('comparison-tournament-select');

    if (!tournamentFolder) {
      this.showError('Please select a tournament first.');
      return;
    }

    try {
      // Load main tournament data
      this.currentTournamentData = await fetchReportResource<TournamentReportData>(
        `${tournamentFolder}/master.json`,
        'tournament data',
        'object',
        'tournament data'
      );

      // Load comparison tournament data if selected
      if (comparisonTournamentFolder && comparisonTournamentFolder !== tournamentFolder) {
        try {
          this.comparisonTournamentData = await fetchReportResource<TournamentReportData>(
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
          this.previousTournamentData = await fetchReportResource<TournamentReportData>(
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
      logger.error('Failed to generate graphics:', error);
      this.showError(`Failed to load tournament data: ${(error as Error).message}`);
    }
  }

  async renderGraphics(): Promise<void> {
    const displayMode = this.getFieldValue('display-mode') as DisplayMode;
    const layoutValue = this.getFieldValue('graphics-layout');
    const layoutSize = parseInt(layoutValue, 10) || 20;

    let filteredData = this.getFilteredData(displayMode);
    filteredData = filteredData.slice(0, layoutSize);

    const output = document.getElementById('graphics-output');
    if (!output) {
      return;
    }
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

  createHeaderSection(displayMode: DisplayMode): HTMLElement {
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

  getFilteredData(displayMode: DisplayMode): ReportCard[] {
    if (!this.currentTournamentData) {
      return [];
    }
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

  getRisingCards(currentData: ReportCard[]): Array<ReportCard & { increase: number; previousPct: number }> {
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
    const comparisonLookup = new Map<string, number>();
    comparisonData.items.forEach(card => {
      if (!card.uid) {
        return;
      }
      comparisonLookup.set(card.uid, card.pct);
    });

    // Calculate increases and filter out new cards (0% to something)
    const risingCards: Array<ReportCard & { increase: number; previousPct: number }> = [];
    currentData.forEach(card => {
      if (!card.uid) {
        return;
      }
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

  isConsistentLeader(card: ReportCard): boolean {
    const cardKey = card.name.replace(/[^a-zA-Z0-9]/g, '_');
    return this.consistentLeaders.has(cardKey);
  }

  async createCardGraphic(
    card: ReportCard,
    displayRank: number,
    displayMode: DisplayMode = 'standard',
    cardSize: CardSize = 'normal'
  ): Promise<HTMLDivElement> {
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
    rankBadge.textContent = String(displayRank);
    cardDiv.appendChild(rankBadge);

    const imageContainer = document.createElement('div');
    imageContainer.className = 'card-image-container';

    const img = document.createElement('img');
    img.className = 'card-image';

    const imagePath = await this.loadImageWithFallback(card, cardSize);
    if (imagePath) {
      img.alt = card.name;

      // Wait for the blob URL to actually load before cropping
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = error => {
            logger.error(`Failed to load blob image for ${card.name}:`, error);
            reject(error);
          };
          img.src = imagePath;
        });

        await this.applyCropping(img, card, cardSize);
      } catch (error) {
        logger.error(`Image load failed for ${card.name}:`, error);
        // Fall through to show placeholder
        img.style.backgroundColor = '#ddd';
        img.style.display = 'flex';
        img.style.alignItems = 'center';
        img.style.justifyContent = 'center';
        img.style.color = '#666';
        img.innerHTML = 'Load Error';
      }
    } else {
      img.style.backgroundColor = '#ddd';
      img.style.display = 'flex';
      img.style.alignItems = 'center';
      img.style.justifyContent = 'center';
      img.style.color = '#666';
      img.innerHTML = 'No Image';
      logger.warn(`No image found for ${card.name} (${card.set} ${card.number})`);
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

  async loadImageWithFallback(card: ReportCard, _cardSize: CardSize = 'normal'): Promise<string | null> {
    const variant = {
      set: card.set,
      number: card.number
    };

    const proxyCandidate = this.buildProxyThumbnailUrl(card.set, card.number);
    const rawCandidates = buildThumbCandidates(card.name, true, undefined, variant) || [];

    const externalCandidates = rawCandidates.filter(candidate => {
      return typeof candidate === 'string' && candidate.startsWith('http');
    });

    const candidates: string[] = [];
    if (proxyCandidate) {
      candidates.push(proxyCandidate);
    }

    externalCandidates.forEach(candidate => {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    });

    for (const path of candidates) {
      try {
        const blobUrl = await this.fetchImageAsBlob(path);
        if (blobUrl) {
          return blobUrl;
        }
      } catch {
        continue;
      }
    }

    logger.warn(
      `Failed to load thumbnail for ${card.name} (${card.set} ${card.number}). Tried ${candidates.length} candidates.`
    );
    return null;
  }

  buildProxyThumbnailUrl(
    setCode: string | null | undefined,
    number: string | number | null | undefined,
    useSm = true
  ): string | null {
    if (!setCode || !number) {
      return null;
    }

    const normalizedSet = String(setCode).toUpperCase().trim();
    const normalizedNumber = String(number).trim();

    if (!normalizedSet || !normalizedNumber) {
      return null;
    }

    const size = useSm ? 'sm' : 'xs';
    return `/thumbnails/${size}/${normalizedSet}/${normalizedNumber}`;
  }

  async fetchImageAsBlob(url: string): Promise<string | null> {
    if (!url) {
      return null;
    }

    if (this.imageBlobCache.has(url)) {
      return this.imageBlobCache.get(url) || null;
    }

    try {
      logger.debug(`Fetching image blob from: ${url}`);

      // Determine if this is an external URL
      const isExternal = url.startsWith('http://') || url.startsWith('https://');

      const response = await fetch(url, {
        mode: isExternal ? 'no-cors' : 'cors',
        credentials: 'omit'
      });

      // For no-cors mode, we can't check response.ok or get blob type
      // Just try to create the blob
      const blob = await response.blob();
      logger.debug(`Blob created for ${url}: ${blob.type || 'opaque'} ${blob.size} bytes`);

      // Skip type validation for opaque responses (no-cors)
      if (!isExternal && blob.type && !blob.type.startsWith('image/')) {
        logger.warn(`Invalid blob type for ${url}: ${blob.type}`);
        return null;
      }

      const objectUrl = URL.createObjectURL(blob);
      logger.debug(`Object URL created: ${objectUrl}`);
      this.imageBlobCache.set(url, objectUrl);
      return objectUrl;
    } catch (error) {
      logger.warn(`Failed to download image blob from ${url}:`, error);
      return null;
    }
  }

  applyCropping(img: HTMLImageElement, card: ReportCard, _cardSize: CardSize = 'normal'): Promise<void> {
    return new Promise<void>(resolve => {
      // Prevent recursive cropping by checking if already processed
      if (img.dataset.cropped === 'true') {
        resolve(undefined);
        return;
      }

      const originalOnload = () => {
        try {
          // Mark as processed to prevent recursion
          // eslint-disable-next-line no-param-reassign
          img.dataset.cropped = 'true';

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(undefined);
            return;
          }

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
          logger.warn(`Failed to crop image for ${card.name}:`, error);
        }
        resolve(undefined);
      };

      // eslint-disable-next-line no-param-reassign
      img.onload = originalOnload;

      // eslint-disable-next-line no-param-reassign
      img.onerror = () => {
        logger.warn(`Failed to load image for ${card.name}`);
        resolve(undefined);
      };

      if (img.complete && img.naturalWidth > 0) {
        originalOnload();
      }
    });
  }

  getCropParameters(card: ReportCard): { left: number; right: number; top: number; bottom: number } {
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

  determineCardType(card: ReportCard): CardType {
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

  createHistogram(distribution: CardDistributionEntry[]): HTMLElement {
    const histogram = document.createElement('div');
    histogram.className = 'histogram';

    // Filter to only show 1-4 copies (Pokemon cards max 4)
    const validDist = distribution.filter(dist => (dist.copies ?? 0) <= 4);
    const maxPlayers = Math.max(1, ...validDist.map(dist => dist.players ?? 0));

    validDist.forEach(dist => {
      const bar = document.createElement('div');
      bar.className = 'histogram-bar';
      const copies = dist.copies ?? 0;
      const players = dist.players ?? 0;
      const percent = dist.percent ?? 0;
      bar.style.height = `${(players / maxPlayers) * 15}px`;
      bar.textContent = String(copies);
      bar.title = `${copies} copies: ${players} players (${percent}%)`;
      histogram.appendChild(bar);
    });

    return histogram;
  }

  async exportGraphics(format: 'png' | 'jpg'): Promise<void> {
    if (!this.currentTournamentData) {
      this.showError('Please generate graphics first.');
      return;
    }

    const output = document.getElementById('graphics-output');
    if (!output) {
      this.showError('Could not find output container.');
      return;
    }

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
      logger.error('Export failed:', error);
      this.showError('Export failed. Please try again.');
    } finally {
      this.cleanupImageBlobs();
    }
  }

  cleanupImageBlobs(): void {
    if (!this.imageBlobCache || this.imageBlobCache.size === 0) {
      return;
    }

    this.imageBlobCache.forEach(objectUrl => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        logger.warn('Failed to revoke object URL:', error);
      }
    });

    this.imageBlobCache.clear();
  }
}

const html2canvas = (() => {
  return function (element: HTMLElement, options?: Html2CanvasOptions): Promise<HTMLCanvasElement> {
    return new Promise<HTMLCanvasElement>((resolve, reject) => {
      const globalWindow = window as Window & {
        html2canvas?: (target: HTMLElement, canvasOptions?: Html2CanvasOptions) => Promise<HTMLCanvasElement>;
      };
      if (typeof globalWindow.html2canvas !== 'undefined') {
        globalWindow
          .html2canvas(element, options)
          .then((canvas: HTMLCanvasElement) => resolve(canvas))
          .catch(reject);
      } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => {
          if (!globalWindow.html2canvas) {
            reject(new AppError(ErrorTypes.RENDER, 'html2canvas failed to load'));
            return;
          }
          globalWindow
            .html2canvas(element, options)
            .then((canvas: HTMLCanvasElement) => resolve(canvas))
            .catch(reject);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      }
    });
  };
})();

if (typeof document !== 'undefined') {
  new SocialGraphicsGenerator();
}
