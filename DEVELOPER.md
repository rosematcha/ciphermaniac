# Ciphermaniac Developer Guide

This document provides guidelines for maintaining and developing the Ciphermaniac codebase.

## Architecture Overview

### Frontend Structure
```
assets/js/
├── main.js           # Application bootstrap and initialization
├── api.js            # API utilities and data fetching
├── config.js         # Application configuration and constants
├── router.js         # URL routing and state management
├── render.js         # DOM rendering and UI updates
├── parse.js          # Data parsing utilities
├── card.js           # Card detail page functionality
├── cardsLanding.js   # Cards landing page
├── controls.js       # UI controls and filtering
├── favorites.js      # Favorites management
├── layoutHelper.js   # Layout calculations and responsive design
├── selectArchetype.js # Archetype selection logic
├── thumbs.js         # Thumbnail handling
├── ui.js             # General UI utilities
├── utils/            # Utility modules
│   ├── constants.js  # Shared constants and selectors
│   ├── errorHandler.js # Error handling and retry logic
│   ├── format.js     # String formatting utilities
│   ├── logger.js     # Centralized logging system
│   ├── performance.js # Performance utilities and debouncing
│   └── storage.js    # LocalStorage wrapper
└── dev/              # Development tools (excluded from production)
    ├── cacheDev.js   # Cache debugging tools
    ├── layoutTests.js # Layout testing utilities
    └── missingThumbs.js # Missing thumbnail detection
```

### CSS Organization
The CSS is organized with:
- CSS custom properties (design tokens) at the top
- Base styles and resets
- Component-specific styles grouped logically
- Responsive breakpoints using mobile-first approach
- Consistent naming conventions following BEM-like patterns

### Data Flow
1. **Initialization**: `main.js` bootstraps the application
2. **Data Loading**: API modules fetch tournament and card data
3. **State Management**: Router handles URL state and navigation
4. **Rendering**: Render modules update the DOM based on state changes
5. **User Interaction**: Control modules handle user input and filters

## Development Guidelines

### Code Style
- Use ES2022+ features (modules, async/await, optional chaining)
- Follow the ESLint configuration for consistent formatting
- Use single quotes for strings, template literals when interpolating
- Add semicolons to all statements
- Use camelCase for variables and functions
- Use PascalCase for classes and constructors
- Add comprehensive JSDoc comments for all functions and classes

### Error Handling
- Use the centralized `errorHandler.js` utilities
- Wrap async operations with `safeAsync()` or `withRetry()`
- Log errors using the logger module, not direct console methods
- Provide meaningful error messages and fallback behavior

### Performance
- Use debouncing for search and resize handlers
- Lazy load images when not in the initial viewport
- Cache API responses using the storage utilities
- Use requestAnimationFrame for smooth animations
- Minimize DOM queries by caching element references

### Accessibility
- Include proper ARIA labels and roles
- Ensure keyboard navigation works correctly
- Use semantic HTML elements
- Maintain sufficient color contrast
- Test with screen readers

### Browser Compatibility
- Target ES2022 but avoid private class fields (use underscore convention)
- Test on mobile Safari, Chrome, Firefox, and Edge
- Use progressive enhancement for advanced features
- Provide fallbacks for older browsers

## Build and Development

### Setup
```bash
npm install
```

### Linting
```bash
npm run lint
```

### Development Tools
- Add `?debug=debug` to the URL for verbose logging
- Add `#dev-missing-thumbs` to enable thumbnail debugging
- Use browser DevTools for performance profiling

## Testing Strategy

### Manual Testing
- Test responsive design at various breakpoints
- Verify keyboard accessibility
- Test with different tournament data sets
- Verify caching behavior works correctly

### Performance Testing
- Use Lighthouse for performance audits
- Test with throttled network connections
- Monitor memory usage during extended sessions

## Deployment

### Pre-deployment Checklist
- [ ] Run linter and fix all errors
- [ ] Test on mobile devices
- [ ] Verify all images load correctly
- [ ] Test with real tournament data
- [ ] Check console for any errors or warnings

### File Structure for Deployment
- All JavaScript files are ES modules (no build step required)
- CSS is written in standard CSS (no preprocessing)
- Images are optimized PNGs in `thumbnails/` directory
- Tournament data is served as static JSON files

## Contributing

### Adding New Features
1. Update the appropriate module in `assets/js/`
2. Add proper JSDoc documentation
3. Update constants in `utils/constants.js` if needed
4. Test thoroughly across different devices
5. Update this documentation if the architecture changes

### Bug Fixes
1. Identify the root cause using the logger and error handling
2. Add defensive code to prevent similar issues
3. Test the fix with edge cases
4. Consider if the fix needs to be applied elsewhere

### Code Review Guidelines
- Ensure code follows the established patterns
- Check that error handling is comprehensive
- Verify performance implications
- Test accessibility features
- Confirm mobile responsiveness