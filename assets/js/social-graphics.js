class SocialGraphicsGenerator {
  constructor() {
    this.tournaments = [];
    this.currentTournamentData = null;
    this.previousTournamentData = null;
    this.consistentLeaders = new Set();
    
    this.init();
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
      const response = await fetch('reports/tournaments.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const tournamentNames = await response.json();
      this.tournaments = tournamentNames.map((name, index) => ({
        folder: name,
        name: name,
        index: index
      })).sort((a, b) => b.folder.localeCompare(a.folder)); // Sort by date desc
      this.populateTournamentSelect();
    } catch (error) {
      console.error('Failed to load tournaments:', error);
      this.showError('Failed to load tournament list');
    }
  }

  populateTournamentSelect() {
    const select = document.getElementById('tournament-select');
    select.innerHTML = '<option value="">Select a tournament...</option>';
    
    this.tournaments.forEach(tournament => {
      const option = document.createElement('option');
      option.value = tournament.folder;
      option.textContent = tournament.name;
      select.appendChild(option);
    });
  }

  async loadConsistentLeaders() {
    try {
      const response = await fetch('reports/suggestions.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const suggestions = await response.json();
      
      // Find the consistent leaders category
      const consistentLeadersCategory = suggestions.categories.find(cat => cat.id === 'consistent-leaders');
      if (consistentLeadersCategory) {
        // Transform card names to match the filtering logic
        consistentLeadersCategory.items.forEach(item => {
          const transformedName = item.name.replace(/[^a-zA-Z0-9]/g, '_');
          this.consistentLeaders.add(transformedName);
        });
        console.log(`Loaded ${this.consistentLeaders.size} consistent leaders`);
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
    const tournamentFolder = document.getElementById('tournament-select').value;
    if (!tournamentFolder) {
      this.showError('Please select a tournament first.');
      return;
    }

    try {
      const response = await fetch(`reports/${tournamentFolder}/master.json`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      this.currentTournamentData = JSON.parse(text);
      
      // Load previous tournament for rising cards comparison
      const currentIndex = this.tournaments.findIndex(t => t.folder === tournamentFolder);
      if (currentIndex < this.tournaments.length - 1) {
        const previousFolder = this.tournaments[currentIndex + 1].folder;
        try {
          const prevResponse = await fetch(`reports/${previousFolder}/master.json`);
          if (prevResponse.ok) {
            const prevText = await prevResponse.text();
            this.previousTournamentData = JSON.parse(prevText);
          }
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
    const displayMode = document.getElementById('display-mode').value;
    const maxCards = parseInt(document.getElementById('max-cards').value) || 20;
    
    let filteredData = this.getFilteredData(displayMode);
    filteredData = filteredData.slice(0, maxCards);
    
    const output = document.getElementById('graphics-output');
    output.innerHTML = '';

    if (filteredData.length === 0) return;

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
    if (filteredData.length > 8) {
      const bottomRow = document.createElement('div');
      bottomRow.className = 'bottom-row';
      
      for (let i = 8; i <= 13 && i < filteredData.length; i++) {
        const bottomCard = await this.createCardGraphic(filteredData[i], i + 1, displayMode, 'tiny');
        bottomRow.appendChild(bottomCard);
      }
      
      tournamentLayout.appendChild(tournamentMain);
      tournamentLayout.appendChild(bottomRow);
    } else {
      tournamentLayout.appendChild(tournamentMain);
    }

    output.appendChild(tournamentLayout);
  }

  getFilteredData(displayMode) {
    let data = this.currentTournamentData.items.filter(card => card.set !== 'SVE');
    
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
    if (!this.previousTournamentData) {
      // If no previous data, show message and return empty
      this.showError('No previous tournament data available for comparison. Rising cards mode requires historical data.');
      return [];
    }

    // Create lookup map for previous tournament data
    const previousLookup = new Map();
    this.previousTournamentData.items.forEach(card => {
      previousLookup.set(card.uid, card.pct);
    });

    // Calculate increases and filter out new cards (0% to something)
    const risingCards = [];
    currentData.forEach(card => {
      const previousPct = previousLookup.get(card.uid);
      
      if (previousPct !== undefined && previousPct > 0) {
        const increase = card.pct - previousPct;
        if (increase > 0) {
          risingCards.push({
            ...card,
            increase: increase,
            previousPct: previousPct
          });
        }
      }
    });

    // Sort by increase amount (descending)
    return risingCards.sort((a, b) => b.increase - a.increase);
  }

  isConsistentLeader(card) {
    const cardKey = card.name.replace(/[^a-zA-Z0-9]/g, '_');
    return this.consistentLeaders.has(cardKey);
  }

  async createCardGraphic(card, displayRank, displayMode = 'standard', cardSize = 'normal') {
    const cardDiv = document.createElement('div');
    cardDiv.className = cardSize === 'featured' ? 'card-graphic featured' : 
                       cardSize === 'medium' ? 'card-graphic medium' :
                       cardSize === 'small' ? 'card-graphic small' :
                       cardSize === 'tiny' ? 'card-graphic tiny' : 'card-graphic';
    
    // Add rank badge
    const rankBadge = document.createElement('div');
    rankBadge.className = 'card-rank-badge';
    rankBadge.textContent = displayRank;
    cardDiv.appendChild(rankBadge);
    
    const imageContainer = document.createElement('div');
    imageContainer.className = 'card-image-container';
    
    const img = document.createElement('img');
    img.className = 'card-image';
    
    const imagePath = await this.loadImageWithFallback(card);
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
    usageInfo.style.fontSize = 'var(--font-size-sm)';
    usageInfo.style.color = 'var(--muted)';
    
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

  async loadImageWithFallback(card) {
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
    else if (card.name.includes('Pokégear 3.0') || 
             card.name.includes('Exp. Share') ||
             card.name.match(/\d+\.\d+/) ||  // Decimal numbers like 3.0
             card.name.match(/\w+\.\s+\w+/)) { // Abbreviations like "Exp. Share"
      specialName = card.name.replace(/\s+/g, '_'); // Only convert spaces to underscores
    }
    
    const possiblePaths = [
      `thumbnails/sm/${baseName}_${card.set}_${card.number}.png`,
      `thumbnails/sm/${card.name.replace(/[^a-zA-Z0-9']/g, '_')}_${card.set}_${card.number}.png`,
      `thumbnails/sm/${card.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')}_${card.set}_${card.number}.png`,
      `thumbnails/sm/${specialName.replace(/[^a-zA-Z0-9\-]/g, '_')}_${card.set}_${card.number}.png`
    ];

    console.log(`Trying to load image for: ${card.name} (${card.set} ${card.number})`);
    console.log('Possible paths:', possiblePaths);

    for (const path of possiblePaths) {
      try {
        const img = new Image();
        const loadPromise = new Promise((resolve, reject) => {
          img.onload = () => resolve(path);
          img.onerror = reject;
          img.src = path;
        });
        
        const result = await Promise.race([
          loadPromise,
          new Promise((_, reject) => setTimeout(() => reject('timeout'), 1000))
        ]);
        
        console.log(`Found image at: ${path}`);
        return result;
      } catch (error) {
        console.log(`Failed to load: ${path}`);
        continue;
      }
    }
    
    console.warn(`No image found for ${card.name}`);
    return null;
  }

  async applyCropping(img, card, cardSize = 'normal') {
    return new Promise((resolve) => {
      // Prevent recursive cropping by checking if already processed
      if (img.dataset.cropped === 'true') {
        resolve();
        return;
      }

      const originalOnload = () => {
        try {
          // Mark as processed to prevent recursion
          img.dataset.cropped = 'true';
          
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Use proper aspect ratios for card display
          const canvasWidth = cardSize === 'featured' ? 400 : 
                            cardSize === 'medium' ? 300 :
                            cardSize === 'small' ? 240 :
                            cardSize === 'tiny' ? 200 : 300;
          const canvasHeight = cardSize === 'featured' ? 353 : 
                             cardSize === 'medium' ? 160 :
                             cardSize === 'small' ? 150 :
                             cardSize === 'tiny' ? 125 : 200;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          
          const cropParams = this.getCropParameters(card);
          
          const sourceWidth = Math.max(1, img.naturalWidth - cropParams.left - cropParams.right);
          const sourceHeight = Math.max(1, img.naturalHeight - cropParams.top - cropParams.bottom);
          
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            // Remove the onload handler before changing src to prevent recursion
            img.onload = null;
            img.onerror = null;
            
            // Calculate aspect ratios
            const sourceAspect = sourceWidth / sourceHeight;
            const targetAspect = canvasWidth / canvasHeight;
            
            let drawWidth, drawHeight, drawX, drawY;
            
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
              cropParams.left, cropParams.top, sourceWidth, sourceHeight,
              drawX, drawY, drawWidth, drawHeight
            );
            
            img.src = canvas.toDataURL();
          }
        } catch (error) {
          console.warn(`Failed to crop image for ${card.name}:`, error);
        }
        resolve();
      };

      img.onload = originalOnload;
      
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
    console.log(`Card: ${card.name} -> Type: ${cardType}`);
    
    const sidesCrop = parseInt(document.getElementById('crop-sides').value) || 22;
    
    // Use card-type-specific top crop, calculate bottom to maintain consistent final height
    if (cardType === 'pokemon') {
      const topCrop = parseInt(document.getElementById('pokemon-crop-top').value) || 13;
      const targetHeight = 144;
      const availableHeight = 381 - topCrop;  // 274x381 thumbnails
      const bottomCrop = Math.max(0, availableHeight - targetHeight - 100); // Leave some buffer
      
      return {
        left: sidesCrop,
        right: sidesCrop,
        top: topCrop,
        bottom: bottomCrop
      };
    } else {
      // Trainers, special-energy, etc.
      const topCrop = parseInt(document.getElementById('trainer-crop-top').value) || 23;
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
  }

  determineCardType(card) {
    const name = card.name;
    
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
    if (name.includes('Ball') || name.includes('Rod') || name.includes('Catcher') ||
        name.includes('Switch') || name.includes('Belt') || name.includes('Helmet') ||
        name.includes('Orders') || name.includes('Research') || name.includes('Scenario') ||
        name.includes('Vitality') || name.includes('Tower') || name.includes('Stadium') ||
        name.includes('Training') || name.includes('Guidance') || name.includes('Aid') ||
        name.includes('Machine') || name.includes('Basket') || name.includes('Retrieval') ||
        name.includes('Hammer') || name.includes('Potion') || name.includes('Stretcher') ||
        name.includes('Vessel') || name.includes('Candy') || name.includes('Poffin')) {
      return 'trainer';
    }
    
    // Explicit trainer cards (supporters, items, stadiums)
    const trainerNames = [
      'Arven', 'Iono', 'Artazon', 'Energy Search Pro', 'Levincia', 'Hilda', 'Crispin', 
      'Energy Switch', 'Briar', 'Judge', 'Cyrano', 'Jacq', 'Energy Search',
      'Powerglass', 'Penny', 'Mesagoza', 'Carmine', 'Night Stretcher', 
      'Buddy-Buddy Poffin', 'Rare Candy', 'Rescue Board', 'Professor Turo\'s Scenario',
      'Air Balloon', 'Professor Sada\'s Vitality'
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
    const validDist = distribution.filter(d => d.copies <= 4);
    const maxPlayers = Math.max(...validDist.map(d => d.players));
    
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
  new SocialGraphicsGenerator();
});

const html2canvas = (function() {
  return function(element, options) {
    return new Promise((resolve, reject) => {
      if (typeof window.html2canvas !== 'undefined') {
        window.html2canvas(element, options).then(resolve).catch(reject);
      } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => {
          window.html2canvas(element, options).then(resolve).catch(reject);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      }
    });
  };
})();