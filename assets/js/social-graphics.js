class SocialGraphicsGenerator {
  constructor() {
    this.tournaments = [];
    this.currentTournamentData = null;
    this.consistentLeaders = new Set(['Professor_Sada_Vitality', 'Boss_Orders', 'Ultra_Ball', 'Nest_Ball']);
    
    this.init();
  }

  async init() {
    try {
      await this.loadTournaments();
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
      this.tournaments = tournamentNames.map(name => ({
        folder: name,
        name: name
      }));
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
      
      await this.renderGraphics();
    } catch (error) {
      console.error('Failed to generate graphics:', error);
      this.showError(`Failed to load tournament data: ${error.message}`);
    }
  }

  async renderGraphics() {
    const includeConsistentLeaders = document.getElementById('include-consistent-leaders').checked;
    const maxCards = parseInt(document.getElementById('max-cards').value) || 20;
    
    let filteredData = this.currentTournamentData.items.filter(card => {
      if (card.set === 'SVE') return false;
      
      if (!includeConsistentLeaders && this.isConsistentLeader(card)) {
        return false;
      }
      
      return true;
    });

    filteredData = filteredData.slice(0, maxCards);
    
    const output = document.getElementById('graphics-output');
    output.innerHTML = '';

    for (const card of filteredData) {
      const cardGraphic = await this.createCardGraphic(card);
      output.appendChild(cardGraphic);
    }
  }

  isConsistentLeader(card) {
    const cardKey = card.name.replace(/[^a-zA-Z0-9]/g, '_');
    return this.consistentLeaders.has(cardKey);
  }

  async createCardGraphic(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card-graphic';
    
    const imageContainer = document.createElement('div');
    imageContainer.className = 'card-image-container';
    
    const img = document.createElement('img');
    img.className = 'card-image';
    
    const imagePath = await this.loadImageWithFallback(card);
    if (imagePath) {
      img.src = imagePath;
      img.alt = card.name;
      await this.applyCropping(img, card);
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
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'card-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'card-name';
    const cardType = this.determineCardType(card);
    nameDiv.textContent = `${card.name} [${cardType.toUpperCase()}]`;
    
    const rankDiv = document.createElement('div');
    rankDiv.className = 'card-rank';
    rankDiv.textContent = `Rank #${card.rank}`;
    
    const usageDiv = document.createElement('div');
    usageDiv.className = 'card-usage';
    usageDiv.textContent = `Used in ${card.pct}% of decks (${card.found}/${card.total})`;
    
    const histogram = this.createHistogram(card.dist);
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(rankDiv);
    infoDiv.appendChild(usageDiv);
    infoDiv.appendChild(histogram);
    
    cardDiv.appendChild(imageContainer);
    cardDiv.appendChild(infoDiv);
    
    return cardDiv;
  }

  getCardImagePath(card) {
    const imageName = `${card.name.replace(/[^a-zA-Z0-9]/g, '_')}_${card.set}_${card.number}.png`;
    return `thumbnails/sm/${imageName}`;
  }

  async loadImageWithFallback(card) {
    const baseName = card.name.replace(/[^a-zA-Z0-9]/g, '_');
    const possiblePaths = [
      `thumbnails/sm/${baseName}_${card.set}_${card.number}.png`,
      `thumbnails/sm/${card.name.replace(/[^a-zA-Z0-9']/g, '_')}_${card.set}_${card.number}.png`,
      `thumbnails/sm/${card.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')}_${card.set}_${card.number}.png`
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

  async applyCropping(img, card) {
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
          
          canvas.width = 230;
          canvas.height = 144;
          
          const cropParams = this.getCropParameters(card);
          
          const sourceWidth = Math.max(1, img.naturalWidth - cropParams.left - cropParams.right);
          const sourceHeight = Math.max(1, img.naturalHeight - cropParams.top - cropParams.bottom);
          
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            // Remove the onload handler before changing src to prevent recursion
            img.onload = null;
            img.onerror = null;
            
            // Calculate aspect ratios
            const sourceAspect = sourceWidth / sourceHeight;
            const targetAspect = 230 / 144;
            
            let drawWidth, drawHeight, drawX, drawY;
            
            if (sourceAspect > targetAspect) {
              // Source is wider, fit to height and crop sides
              drawHeight = 144;
              drawWidth = drawHeight * sourceAspect;
              drawX = (230 - drawWidth) / 2;
              drawY = 0;
            } else {
              // Source is taller, fit to width and crop top/bottom
              drawWidth = 230;
              drawHeight = drawWidth / sourceAspect;
              drawX = 0;
              drawY = (144 - drawHeight) / 2;
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
    
    const maxPlayers = Math.max(...distribution.map(d => d.players));
    
    distribution.forEach(dist => {
      const bar = document.createElement('div');
      bar.className = 'histogram-bar';
      bar.style.height = `${(dist.players / maxPlayers) * 35}px`;
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
        scale: 2,
        useCORS: true
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