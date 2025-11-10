# Ciphermaniac

A comprehensive Pokemon TCG tournament data visualization and analysis tool. Explore card usage statistics, pricing trends, and meta analysis from major tournaments worldwide.

**Live Site:** [ciphermaniac.com](https://ciphermaniac.com)

## Features

### Tournament Analysis

- **Card Usage Statistics**: View usage percentages and distribution across tournament decks
- **Archetype Analysis**: Filter by popular deck archetypes and strategies
- **Meta Tracking**: Compare performance across different tournament formats and regions
- **Historical Data**: Access tournament reports from major events including Regionals, NAIC, and World Championships

### Interactive Interface

- **Search & Filter**: Find specific cards, archetypes, or tournament formats
- **Sorting Options**: Sort by usage percentage, alphabetical order, or card prices
- **Responsive Grid**: Optimized layout for desktop and mobile viewing
- **Card Thumbnails**: Visual card identification with hover overlays

### Pricing Integration

- **Real-time Pricing**: Current market prices for competitive cards
- **Price Tracking**: Monitor price trends over time
- **Budget Analysis**: Evaluate deck costs and card value


## Project Structure

```
├── assets/                 # Frontend assets
│   ├── js/                # JavaScript modules
│   │   ├── components/    # Reusable UI components
│   │   ├── config/        # Configuration files
│   │   ├── dev/           # Development utilities
│   │   └── utils/         # Helper functions
│   └── style.css          # Main stylesheet
├── backend/               # Backend services
│   └── database/          # Database schema and setup
├── functions/             # Cloud functions
│   ├── api/              # API endpoints
│   └── _cron/            # Scheduled tasks
├── reports/               # Tournament data
│   └── [tournament]/      # Individual tournament reports
│       ├── archetypes/    # Deck archetype data
│       ├── cardIndex.json # Card usage index
│       ├── decks.json     # Deck lists
│       └── meta.json      # Meta analysis
├── thumbnails/            # Card image assets
│   ├── sm/               # Small thumbnails
│   └── xs/               # Extra small thumbnails
└── tools/                # Data processing tools
```
## Getting Started

### Prerequisites

- Node.js 16.0.0 or higher
- Python 3.x (for data processing tools)

### Installation

1. Clone the repository:
   
   ```bash
   git clone https://github.com/your-username/Ciphermaniac.git
   cd Ciphermaniac
   ```
2. Install dependencies:
   
   ```bash
   npm install
   ```
3. Start the development server (uses the Node test server with hosting rewrites for `/card` routes):
   
   ```bash
   npm run dev
   ```
4. Open [http://localhost:8000](http://localhost:8000) in your browser

### Development Commands

```bash
npm run lint          # Check code quality
npm run lint:fix      # Fix linting issues
npm run typecheck     # Run TypeScript type checking
npm run validate      # Run all validation checks
npm run dev           # Start development server
```

### Environment Variables

Copy `.env.example` to `.env` and add your secrets before running tooling that talks to third‑party services:

```
LIMITLESS_API_KEY=your_limitless_api_key_here
```

Cloudflare Pages/Workers deployments should define the same `LIMITLESS_API_KEY` variable in the dashboard or via `wrangler` so serverless functions can reach the Limitless API without leaking the key to the browser.

## Data Sources

Tournament data is sourced from [LimitlessTCG](https://limitlesstcg.com) including:

- Regional Championships
- Special Events
- North American International Championships (NAIC)
- World Championships
- Local tournaments and league events

Card pricing data is integrated from multiple market sources to provide accurate valuations.


## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure your code passes all validation checks before submitting.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Tournament data provided by [LimitlessTCG](https://limitlesstcg.com)
- Pokemon Trading Card Game and all related intellectual property are owned by The Pokemon Company International
- This project is not affiliated with or endorsed by The Pokemon Company International
- Community contributors and data collectors


